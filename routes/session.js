/**
 * session.js — Board session orchestrator (SSE)
 * Phases: brief → parallel deliberation → challenge → decision packet → vault minutes
 */

import { Router } from 'express';
import { collectStream } from '../utils/llm_router.js';
import { resolveKey, DEFAULT_ROLE_MODELS, PROVIDERS } from '../utils/providers.js';
import { extractClientKeys } from '../utils/client_keys.js';
import { writeVault, logSystemEvent } from '../utils/vault.js';
import { orchestrateMessage, completeTask, failTask } from '../utils/paperclip_orchestration.js';
import {
  pickSeats,
  pickChallenger,
  briefPrompt,
  memberPrompt,
  challengePrompt,
  packetPrompt,
  parsePacket,
  minutesMarkdown,
  slugify,
  demoSession,
} from '../utils/board_session.js';

const router = Router();

function anyKey(clientKeys) {
  return Object.keys(PROVIDERS).some((id) => !!resolveKey(id, clientKeys));
}

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function streamDemo(res, directive, sessionId, send) {
  const demo = demoSession(directive);
  send({ type: 'phase', phase: 'brief' });
  send({ type: 'member_start', role: 'jarvis', phase: 'brief' });
  for (const chunk of demo.brief.match(/.{1,40}/g) || [demo.brief]) {
    send({ type: 'delta', role: 'jarvis', phase: 'brief', delta: chunk });
    await sleep(12);
  }
  send({ type: 'member_done', role: 'jarvis', phase: 'brief', content: demo.brief });

  send({ type: 'phase', phase: 'deliberate', seats: demo.seats });
  await Promise.all(
    demo.seats.map(async (role) => {
      send({ type: 'member_start', role, phase: 'deliberate' });
      const text = demo.transcripts[role];
      for (const chunk of text.match(/.{1,48}/g) || [text]) {
        send({ type: 'delta', role, phase: 'deliberate', delta: chunk });
        await sleep(10);
      }
      send({ type: 'member_done', role, phase: 'deliberate', content: text });
    })
  );

  send({ type: 'phase', phase: 'challenge', role: demo.challenge.role });
  send({ type: 'member_start', role: demo.challenge.role, phase: 'challenge' });
  for (const chunk of demo.challenge.content.match(/.{1,40}/g) || [demo.challenge.content]) {
    send({ type: 'delta', role: demo.challenge.role, phase: 'challenge', delta: chunk });
    await sleep(12);
  }
  send({
    type: 'member_done',
    role: demo.challenge.role,
    phase: 'challenge',
    content: demo.challenge.content,
  });

  send({ type: 'phase', phase: 'packet' });
  send({ type: 'packet', packet: demo.packet, demo: true });
  send({ type: 'done', demo: true, sessionId, seats: demo.seats });
}

router.post('/session/stream', async (req, res) => {
  const {
    message,
    sessionId = 'default',
    roleModels = {},
    provider = null,
    model = null,
  } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (obj) => {
    if (!res.writableEnded) sse(res, obj);
  };

  const clientKeys = extractClientKeys(req);
  const mergedRoleModels = { ...DEFAULT_ROLE_MODELS, ...roleModels };
  const seats = pickSeats(message);
  const challenger = pickChallenger(seats, message);
  const id = `sess-${Date.now().toString(36)}`;
  let taskId = null;

  send({ type: 'session', id, seats, challenger, sessionId });

  try {
    const orch = await orchestrateMessage({ message, sessionId, role: 'jarvis' });
    taskId = orch?.task?.id || null;
    if (taskId) send({ type: 'task', taskId });
  } catch {
    /* ignore */
  }

  if (!anyKey(clientKeys)) {
    await streamDemo(res, message, sessionId, send);
    if (taskId) await completeTask(taskId, 'Demo board session');
    return res.end();
  }

  const llmBase = { clientKeys, roleModels: mergedRoleModels, provider, model };

  try {
    // ── 1. Brief ──────────────────────────────────────────
    send({ type: 'phase', phase: 'brief' });
    send({ type: 'member_start', role: 'jarvis', phase: 'brief' });
    const briefResult = await collectStream(
      {
        ...llmBase,
        role: 'jarvis',
        prompt: briefPrompt(message),
        temperature: 0.4,
        maxTokens: 320,
      },
      (delta) => send({ type: 'delta', role: 'jarvis', phase: 'brief', delta })
    );
    const brief = briefResult.content || '';
    send({ type: 'member_done', role: 'jarvis', phase: 'brief', content: brief, model: briefResult.model });

    if (req.aborted) {
      res.end();
      return;
    }

    // ── 2. Parallel deliberation ──────────────────────────
    send({ type: 'phase', phase: 'deliberate', seats });
    const transcripts = {};
    await Promise.all(
      seats.map(async (role) => {
        send({ type: 'member_start', role, phase: 'deliberate' });
        try {
          const result = await collectStream(
            {
              ...llmBase,
              role,
              prompt: memberPrompt(message, brief, role),
              temperature: 0.5,
              maxTokens: 420,
            },
            (delta) => send({ type: 'delta', role, phase: 'deliberate', delta })
          );
          transcripts[role] = result.content || '';
          send({
            type: 'member_done',
            role,
            phase: 'deliberate',
            content: transcripts[role],
            model: result.model,
            provider: result.provider,
          });
        } catch (err) {
          transcripts[role] = `(${role} failed: ${err.message.slice(0, 180)})`;
          send({ type: 'member_error', role, phase: 'deliberate', error: err.message });
          send({ type: 'member_done', role, phase: 'deliberate', content: transcripts[role] });
        }
      })
    );

    if (req.aborted) {
      res.end();
      return;
    }

    // ── 3. Challenge ──────────────────────────────────────
    send({ type: 'phase', phase: 'challenge', role: challenger });
    send({ type: 'member_start', role: challenger, phase: 'challenge' });
    let challengeContent = '';
    try {
      const ch = await collectStream(
        {
          ...llmBase,
          role: challenger,
          prompt: challengePrompt(message, brief, transcripts, challenger),
          temperature: 0.3,
          maxTokens: 360,
        },
        (delta) => send({ type: 'delta', role: challenger, phase: 'challenge', delta })
      );
      challengeContent = ch.content || '';
      send({
        type: 'member_done',
        role: challenger,
        phase: 'challenge',
        content: challengeContent,
        model: ch.model,
      });
    } catch (err) {
      challengeContent = `(challenge failed: ${err.message.slice(0, 180)})`;
      send({ type: 'member_error', role: challenger, error: err.message });
      send({ type: 'member_done', role: challenger, phase: 'challenge', content: challengeContent });
    }

    if (req.aborted) {
      res.end();
      return;
    }

    // ── 4. Decision packet ────────────────────────────────
    send({ type: 'phase', phase: 'packet' });
    send({ type: 'member_start', role: 'jarvis', phase: 'packet' });
    let packet = null;
    let packetRaw = '';
    try {
      const pk = await collectStream(
        {
          ...llmBase,
          role: 'jarvis',
          prompt: packetPrompt(message, brief, transcripts, {
            role: challenger,
            content: challengeContent,
          }),
          temperature: 0.2,
          maxTokens: 500,
        },
        (delta) => send({ type: 'delta', role: 'jarvis', phase: 'packet', delta })
      );
      packetRaw = pk.content || '';
      packet = parsePacket(packetRaw);
      send({ type: 'member_done', role: 'jarvis', phase: 'packet', content: packetRaw, model: pk.model });
    } catch (err) {
      send({ type: 'member_error', role: 'jarvis', phase: 'packet', error: err.message });
    }

    if (!packet) {
      packet = {
        decision: packetRaw.slice(0, 280) || 'Board recorded deliberation without a structured packet.',
        goal: message.slice(0, 180),
        plan: Object.keys(transcripts).map((r) => `${r} to execute their next action`),
        risks: [challengeContent.split('\n').find((l) => l.trim()) || 'See challenge notes'],
        actions: seats.map((r) => ({ owner: r, action: 'Follow through on seated recommendation' })),
        files: [],
        dissent: challengeContent.slice(0, 240),
      };
    }
    send({ type: 'packet', packet });

    // ── 5. Vault minutes ──────────────────────────────────
    const day = new Date().toISOString().slice(0, 10);
    const vaultPath = `sessions/${day}-${slugify(message)}.md`;
    try {
      await writeVault(
        vaultPath,
        minutesMarkdown({
          directive: message,
          brief,
          seats,
          transcripts,
          challenge: { role: challenger, content: challengeContent },
          packet,
          id,
        })
      );
      send({ type: 'vault', path: vaultPath });
      await logSystemEvent('jarvis', 'SESSION', `Board session ${id} → ${vaultPath}`);
    } catch (err) {
      send({ type: 'vault_error', error: err.message });
    }

    if (taskId) await completeTask(taskId, `Board session ${id}`);
    send({ type: 'done', id, sessionId, seats, challenger, vaultPath, taskId });
  } catch (err) {
    console.error('[SESSION]', err.message);
    if (taskId) await failTask(taskId, err.message);
    send({ type: 'error', error: err.message });
    send({ type: 'done', error: true });
  }

  res.end();
});

export default router;
