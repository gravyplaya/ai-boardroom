/**
 * board_session.js — Seat selection + prompt packs for a real board meeting
 */

export const ROLE_LABELS = {
  jarvis: 'JARVIS',
  architect: 'The Architect',
  coder: 'The Coder',
  creative: 'The Creative',
  analyst: 'The Analyst',
  product: 'The Product Manager',
  devops: 'The DevOps Lead',
  security: 'The Security Officer',
  qa: 'The QA Lead',
};

const RULES = [
  { re: /code|implement|api|bug|refactor|function|mvp|app|repo|typescript|python|deploy/i, roles: ['coder', 'architect'] },
  { re: /design|brand|copy|landing|ui|ux|visual|marketing/i, roles: ['creative', 'product'] },
  { re: /market|research|compet|pricing|data|analy|forecast|cfo/i, roles: ['analyst', 'product'] },
  { re: /roadmap|user stor|requirement|mvp|feature|backlog/i, roles: ['product', 'architect'] },
  { re: /infra|ci\/cd|docker|k8s|scale|observab|sre/i, roles: ['devops', 'coder'] },
  { re: /auth|secur|xss|owasp|privacy|encrypt|ciso/i, roles: ['security', 'coder'] },
  { re: /test|qa|regress|edge case|quality/i, roles: ['qa', 'coder'] },
];

export function pickSeats(directive = '') {
  const scored = new Map();
  scored.set('architect', 1);
  for (const rule of RULES) {
    if (!rule.re.test(directive)) continue;
    for (const r of rule.roles) scored.set(r, (scored.get(r) || 0) + 2);
  }
  const seats = [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([r]) => r)
    .filter((r) => r !== 'jarvis')
    .slice(0, 3);
  if (!seats.includes('architect') && seats.length < 3) seats.unshift('architect');
  return [...new Set(seats)].slice(0, 3);
}

export function pickChallenger(seats, directive = '') {
  if (/auth|secur|privacy|xss/i.test(directive)) return 'security';
  if (/test|qa|ship|launch/i.test(directive)) return 'qa';
  if (seats.includes('coder') || seats.includes('devops')) return 'security';
  return 'qa';
}

export function briefPrompt(directive) {
  return `Stakeholder directive:\n"""${directive}"""\n\nWrite a 5-line board brief:
1. Goal (one sentence)
2. Constraints (time, quality, risk)
3. Who should speak and why
4. What "done" looks like
5. What we will NOT do

Be terse. No preamble.`;
}

export function memberPrompt(directive, brief, role) {
  return `BOARD SESSION

Stakeholder directive:
"""${directive}"""

JARVIS brief:
${brief}

You are seated as ${ROLE_LABELS[role] || role}. Give YOUR seat's view only.
- 4–7 short bullets
- Be specific and opinionated
- Call out one dissent or risk
- End with a single recommended next action for YOUR function
No fluff, no repeating the brief.`;
}

export function challengePrompt(directive, brief, transcripts, challenger) {
  const body = Object.entries(transcripts)
    .map(([role, text]) => `### ${ROLE_LABELS[role] || role}\n${text}`)
    .join('\n\n');
  return `You are ${ROLE_LABELS[challenger]}. The board just spoke. Challenge the plan.

Directive: ${directive}

Brief:
${brief}

Deliberation:
${body}

Output:
- 3 hardest questions / blockers
- What would make you REJECT this
- One condition you'd accept
Be sharp.`;
}

export function packetPrompt(directive, brief, transcripts, challenge) {
  const body = Object.entries(transcripts)
    .map(([role, text]) => `### ${ROLE_LABELS[role] || role}\n${text}`)
    .join('\n\n');
  return `Compile the Decision Packet for this board session. Return ONLY JSON (no markdown fences):

{
  "decision": "one-sentence decision",
  "goal": "goal",
  "plan": ["step 1", "step 2", "step 3"],
  "risks": ["risk 1", "risk 2"],
  "actions": [{"owner":"coder","action":"…"},{"owner":"product","action":"…"}],
  "files": ["path or artifact name"],
  "dissent": "the strongest unresolved objection"
}

Directive: ${directive}

Brief:
${brief}

Deliberation:
${body}

Challenge (${challenge.role}):
${challenge.content}`;
}

export function parsePacket(text) {
  if (!text) return null;
  try {
    const match = String(text).match(/\{[\s\S]*\}/);
    const json = JSON.parse(match ? match[0] : text);
    if (!json.decision && !json.goal) return null;
    return {
      decision: String(json.decision || json.goal || ''),
      goal: String(json.goal || json.decision || ''),
      plan: Array.isArray(json.plan) ? json.plan.map(String) : [],
      risks: Array.isArray(json.risks) ? json.risks.map(String) : [],
      actions: Array.isArray(json.actions)
        ? json.actions.map((a) => ({
            owner: String(a.owner || a.role || 'jarvis'),
            action: String(a.action || a.task || ''),
          }))
        : [],
      files: Array.isArray(json.files) ? json.files.map(String) : [],
      dissent: String(json.dissent || ''),
    };
  } catch {
    return null;
  }
}

export function minutesMarkdown({ directive, brief, seats, transcripts, challenge, packet, id }) {
  const when = new Date().toISOString();
  const lines = [
    `# Board session — ${when.slice(0, 16).replace('T', ' ')}`,
    '',
    `id: \`${id}\``,
    '',
    '## Directive',
    '',
    directive,
    '',
    '## Brief',
    '',
    brief || '_none_',
    '',
    `## Seats: ${seats.map((s) => ROLE_LABELS[s] || s).join(', ')}`,
    '',
  ];
  for (const [role, text] of Object.entries(transcripts || {})) {
    lines.push(`### ${ROLE_LABELS[role] || role}`, '', text || '_silent_', '');
  }
  if (challenge?.content) {
    lines.push(`## Challenge — ${ROLE_LABELS[challenge.role] || challenge.role}`, '', challenge.content, '');
  }
  if (packet) {
    lines.push('## Decision packet', '');
    lines.push(`**Decision:** ${packet.decision}`, '');
    if (packet.plan?.length) lines.push('**Plan**', ...packet.plan.map((p) => `- ${p}`), '');
    if (packet.risks?.length) lines.push('**Risks**', ...packet.risks.map((p) => `- ${p}`), '');
    if (packet.actions?.length) {
      lines.push('**Actions**', ...packet.actions.map((a) => `- **${a.owner}:** ${a.action}`), '');
    }
    if (packet.dissent) lines.push(`**Dissent:** ${packet.dissent}`, '');
  }
  return lines.join('\n');
}

export function slugify(text) {
  return String(text || 'session')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'session';
}

export function demoSession(directive) {
  const seats = pickSeats(directive);
  const challenger = pickChallenger(seats, directive);
  const brief =
    `Goal: turn this directive into a shippable plan.\nConstraints: one session, honest dissent, no vapor.\nSeats: ${seats.join(', ')}.\nDone: a decision packet with owners.\nWon't: pretend connectors or fake deploys.`;
  const transcripts = {};
  for (const role of seats) {
    transcripts[role] =
      `Demo seat (${ROLE_LABELS[role]}): add NVIDIA or another key in Settings to hear a live deliberation.\n- I would own the ${role} slice of this work.\n- Risk: running without a model key means no real analysis.\nNext: paste a key, re-run this directive.`;
  }
  const challenge = {
    role: challenger,
    content:
      'Demo challenge: I reject shipping theater. Condition to accept: live models, vault minutes, and a packet with owners.',
  };
  const packet = {
    decision: 'Open Settings, add a provider key, and re-run this as a live board session.',
    goal: 'Get the board online with real models.',
    plan: [
      'Add NVIDIA NIM (or OpenRouter / xAI) key in Settings',
      'Re-send this directive in Board mode',
      'Pin the Decision Packet and act on owners',
    ],
    risks: ['Demo answers are not analysis', 'No key = no memory of a real decision'],
    actions: [
      { owner: 'jarvis', action: 'Walk stakeholder through Settings → NVIDIA key' },
      { owner: seats[0] || 'architect', action: 'Re-run this brief live' },
    ],
    files: ['sessions/demo-decision.md'],
    dissent: 'A demo packet is not a company decision.',
  };
  return { seats, challenger, brief, transcripts, challenge, packet };
}

export default {
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
  ROLE_LABELS,
};
