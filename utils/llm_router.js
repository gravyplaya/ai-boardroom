/**
 * llm_router.js — Multi-provider LLM router
 * Priority: NVIDIA NIM → role override → OpenRouter free → other configured providers
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';
import {
  PROVIDERS,
  DEFAULT_ROLE_MODELS,
  OPENROUTER_FREE_MODELS,
  NVIDIA_CURATED_MODELS,
  resolveKey,
  catalogForProvider,
} from './providers.js';
import { env } from './env.js';

dotenv.config({ quiet: true });

// ── Board Member personas ───────────────────────────────────────────────────
const BOARD_PERSONAS = {
  jarvis: {
    description: 'Chief of Staff — fast, conversational, task routing',
    systemPrompt: `You are JARVIS, the Chief of Staff of AI Boardroom — a real production platform where autonomous AI agents build, deploy, and test real software. You are the sole interface between the human stakeholder and the Board of Directors.

Your personality: Professional, concise, proactive, and British-accented in tone. You shield the user from messy intermediate steps.

Your responsibilities:
- Parse user requests into structured briefs
- Route tasks to the appropriate Board Member(s)
- Compile and present final outputs
- Maintain clarity on project status at all times

When the user gives a directive, identify which Board Member(s) should handle it and explain your delegation plan.`,
    temperature: 0.7,
  },
  architect: {
    description: 'CEO / Architect — high-level strategy, system design, project planning',
    systemPrompt: `You are The Architect, the CEO of AI Boardroom. You handle high-level strategy and system design.
Break down large projects into milestones, choose tech stacks, and produce clear specs. Think in systems.`,
    temperature: 0.6,
  },
  coder: {
    description: 'CTO / Coder — engineering, implementation, deployment',
    systemPrompt: `You are The Coder, the CTO of AI Boardroom. Write production-quality code, debug, and ship. Prefer complete, runnable solutions over vague suggestions.`,
    temperature: 0.3,
  },
  creative: {
    description: 'CMO / Creative — design, copywriting, marketing, branding',
    systemPrompt: `You are The Creative, the CMO of AI Boardroom. Handle UI/UX, copy, branding. Be specific: colors, type, hierarchy, implementable design.`,
    temperature: 0.9,
  },
  analyst: {
    description: 'CFO / Analyst — research, data, fact-checking, market analysis',
    systemPrompt: `You are The Analyst, the CFO/Researcher of AI Boardroom. Be precise, cite reasoning, challenge assumptions with data.`,
    temperature: 0.4,
  },
  product: {
    description: 'CPO / Product Manager — roadmaps, requirements, user stories',
    systemPrompt: `You are The Product Manager (CPO). Translate strategy into user stories, prioritize by value, define Definition of Done.`,
    temperature: 0.7,
  },
  devops: {
    description: 'Head of Infrastructure — CI/CD, deployment, cloud scaling',
    systemPrompt: `You are The DevOps Lead. Own CI/CD, infra, observability, zero-downtime deploys. Think in pipelines and reliability.`,
    temperature: 0.2,
  },
  security: {
    description: 'CISO / Security Officer — audits, encryption, auth hardening',
    systemPrompt: `You are The Security Officer (CISO). Audit for XSS/SQLi/CSRF, enforce least privilege, reject unsafe designs.`,
    temperature: 0.1,
  },
  qa: {
    description: 'Chief Quality Officer — testing, bug hunting, UX validation',
    systemPrompt: `You are The QA Lead. Write tests, hunt edge cases, reject incomplete work. Final gate before ship.`,
    temperature: 0.5,
  },
};

function buildMessages({ prompt, messages, systemPrompt }) {
  if (messages && messages.length) {
    const out = messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    return [{ role: 'system', content: systemPrompt }, ...out];
  }
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt || '' },
  ];
}

async function callOpenAICompatible({ baseUrl, apiKey, model, messages, temperature, extraHeaders = {} }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = {
    model,
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: Number(env('LLM_MAX_TOKENS', '2048')),
    stream: false,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text.slice(0, 400)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from provider: ${text.slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty completion from provider');
  return {
    content,
    model: data.model || model,
    usage: data.usage || {},
  };
}

async function callAnthropic({ apiKey, model, messages, temperature }) {
  const system = messages.find((m) => m.role === 'system')?.content || '';
  const anthropicMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: Number(env('LLM_MAX_TOKENS', '2048')),
      temperature: temperature ?? 0.7,
      system,
      messages: anthropicMessages,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  const content = data.content?.map((c) => c.text || '').join('') || '';
  if (!content) throw new Error('Empty Anthropic response');
  return { content, model: data.model || model, usage: data.usage || {} };
}

/**
 * Build ordered attempt list for a role given client prefs.
 * @param {object} opts
 */
export function buildAttemptPlan({ role = 'jarvis', provider, model, roleModels = {}, clientKeys = {} }) {
  const attempts = [];
  const seen = new Set();
  const push = (p, m) => {
    if (!p || !m) return;
    const key = `${p}::${m}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push({ provider: p, model: m });
  };

  // 1) Explicit request override
  if (provider && model) push(provider, model);

  // 2) Per-role assignment from client settings
  const rolePref = roleModels[role] || DEFAULT_ROLE_MODELS[role];
  if (rolePref) push(rolePref.provider, rolePref.model);

  // 3) All curated NVIDIA models if NVIDIA key present (primary stack)
  if (resolveKey('nvidia', clientKeys)) {
    for (const m of NVIDIA_CURATED_MODELS.filter((x) => x.chat !== false).slice(0, 6)) {
      push('nvidia', m.id);
    }
  }

  // 4) OpenRouter free models if key present
  if (resolveKey('openrouter', clientKeys)) {
    for (const m of OPENROUTER_FREE_MODELS.slice(0, 5)) {
      push('openrouter', m.id);
    }
  }

  // 5) Any other configured provider defaults
  for (const pid of ['openai', 'google', 'xai', 'anthropic']) {
    if (!resolveKey(pid, clientKeys)) continue;
    const cat = catalogForProvider(pid);
    if (cat[0]) push(pid, cat[0].id);
  }

  return attempts;
}

async function runAttempt({ provider, model, messages, temperature, clientKeys }) {
  const apiKey = resolveKey(provider, clientKeys);
  if (!apiKey) throw new Error(`No API key for provider ${provider}`);

  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider ${provider}`);

  if (provider === 'anthropic') {
    return callAnthropic({ apiKey, model, messages, temperature });
  }

  const extraHeaders = {};
  if (provider === 'openrouter') {
    extraHeaders['HTTP-Referer'] = env('APP_URL', 'https://ai-boardroom.local');
    extraHeaders['X-Title'] = 'AI Boardroom';
  }

  return callOpenAICompatible({
    baseUrl: p.baseUrl,
    apiKey,
    model,
    messages,
    temperature,
    extraHeaders,
  });
}

/**
 * Route a prompt to the best available LLM.
 */
export async function routeToLLM({
  prompt,
  role = 'jarvis',
  messages = null,
  model = null,
  provider = null,
  temperature = null,
  clientKeys = {},
  roleModels = {},
}) {
  const persona = BOARD_PERSONAS[role];
  if (!persona) {
    throw new Error(`Unknown board member role: "${role}". Valid: ${Object.keys(BOARD_PERSONAS).join(', ')}`);
  }

  const requestMessages = buildMessages({
    prompt,
    messages,
    systemPrompt: persona.systemPrompt,
  });

  const attempts = buildAttemptPlan({ role, provider, model, roleModels, clientKeys });
  if (!attempts.length) {
    throw new Error(
      'Neither NVIDIA_API_KEY nor any other LLM provider key is configured. Add keys in Settings or server env.'
    );
  }

  const errors = [];
  for (const attempt of attempts) {
    try {
      const result = await runAttempt({
        provider: attempt.provider,
        model: attempt.model,
        messages: requestMessages,
        temperature: temperature ?? persona.temperature,
        clientKeys,
      });
      return {
        content: result.content,
        model: result.model,
        provider: attempt.provider,
        role,
        boardMember: persona.description,
        usage: result.usage,
      };
    } catch (err) {
      console.warn(`[LLM] ${attempt.provider}/${attempt.model} failed: ${err.message}`);
      errors.push(`${attempt.provider}/${attempt.model}: ${err.message}`);
    }
  }

  throw new Error(`All providers failed.\n${errors.slice(0, 6).join('\n')}`);
}

export function getBoardMembers(roleModels = {}) {
  return Object.entries(BOARD_PERSONAS).map(([key, config]) => {
    const pref = roleModels[key] || DEFAULT_ROLE_MODELS[key] || {};
    return {
      role: key,
      model: pref.model || 'unassigned',
      provider: pref.provider || 'nvidia',
      description: config.description,
    };
  });
}

export async function identifyBoardMember(taskDescription, opts = {}) {
  const response = await routeToLLM({
    prompt: `Analyze this task and determine which ONE board member should handle it.

Available members:
${Object.entries(BOARD_PERSONAS).map(([k, v]) => `- ${k}: ${v.description}`).join('\n')}

Task: "${taskDescription}"

Respond with ONLY JSON: {"role":"role_key","reason":"why"}`,
    role: 'jarvis',
    temperature: 0.2,
    ...opts,
  });

  try {
    const match = response.content.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : response.content);
  } catch {
    return { role: 'jarvis', reason: 'Defaulting to Jarvis for routing' };
  }
}

export { BOARD_PERSONAS as BOARD_MODELS };
export default { routeToLLM, getBoardMembers, identifyBoardMember };
