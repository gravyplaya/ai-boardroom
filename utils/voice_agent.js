/**
 * voice_agent.js — xAI Grok Voice Agent session builders & boardroom tools
 * Docs: https://docs.x.ai/developers/model-capabilities/audio/voice-agent
 */

export const XAI_VOICE_MODELS = [
  { id: 'grok-voice-latest', name: 'Grok Voice Latest (alias)', description: 'Tracks flagship; becomes think-fast-2.0 on Aug 5 2026' },
  { id: 'grok-voice-think-fast-2.0', name: 'Grok Voice Think Fast 2.0', description: 'Newest speech-to-speech agent' },
  { id: 'grok-voice-think-fast-1.0', name: 'Grok Voice Think Fast 1.0', description: 'Previous-generation voice agent' },
];

export const XAI_BUILTIN_VOICES = [
  { id: 'eve', name: 'Eve', note: 'Default' },
  { id: 'ara', name: 'Ara', note: 'Warm' },
  { id: 'rex', name: 'Rex', note: 'Confident' },
  { id: 'sal', name: 'Sal', note: 'Calm' },
  { id: 'leo', name: 'Leo', note: 'Bright' },
];

export const DEFAULT_VOICE_AGENT = {
  provider: 'xai',
  model: 'grok-voice-latest',
  voice: 'eve',
  customVoiceId: '',
  instructions: '',
  reasoningEffort: 'high', // high | none
  outputSpeed: 1.0,
  languageHint: 'en',
  greetOnConnect: true,
  greetText: 'Hello Sir — Boardroom voice online. How can I help?',
  // Turn detection (server VAD)
  vadEnabled: true,
  vadThreshold: 0.85,
  silenceDurationMs: 700,
  prefixPaddingMs: 333,
  idleTimeoutMs: 0, // 0 = disabled
  // Audio
  sampleRate: 24000,
  // Built-in xAI tools / connectors
  tools: {
    webSearch: true,
    xSearch: true,
    fileSearch: false,
    boardroomFunctions: true,
  },
  webSearch: {
    allowedDomains: '',
    excludedDomains: '',
    enableImageUnderstanding: true,
    country: '',
    city: '',
  },
  xSearch: {
    allowedHandles: '',
    excludedHandles: '',
    fromDate: '',
    toDate: '',
    enableImageUnderstanding: true,
    enableVideoUnderstanding: false,
  },
  fileSearch: {
    vectorStoreIds: '', // comma-separated collection IDs
    maxNumResults: 8,
  },
  // Remote MCP connectors (JSON array in settings UI)
  mcpServers: [],
  // Pronunciation replace map: "phrase=spoken" lines
  replaceMap: '',
};

/** Boardroom function tools for voice agent (xAI function type) */
export function boardroomFunctionTools() {
  return [
    {
      type: 'function',
      name: 'read_file',
      description: 'Read a text file from the boardroom workspace',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path inside the workspace' },
        },
        required: ['filePath'],
      },
    },
    {
      type: 'function',
      name: 'write_file',
      description: 'Write a text file into the boardroom workspace',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['filePath', 'content'],
      },
    },
    {
      type: 'function',
      name: 'execute_cli_command',
      description: 'Run an allowlisted CLI command in the workspace (ls, cat, git, node, npm, python3, …)',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command line without shell metacharacters' },
        },
        required: ['command'],
      },
    },
    {
      type: 'function',
      name: 'get_system_status',
      description: 'Get AI Boardroom platform status, providers, and demo mode',
      parameters: { type: 'object', properties: {} },
    },
    {
      type: 'function',
      name: 'list_board_members',
      description: 'List board member agents and their models',
      parameters: { type: 'object', properties: {} },
    },
    {
      type: 'function',
      name: 'consult_board',
      description: 'Ask a specific board member (or full board) a question and get their text reply',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Question or task' },
          role: {
            type: 'string',
            description: 'Optional member role: jarvis, architect, coder, creative, analyst, product, devops, security, qa. Empty = full board.',
          },
        },
        required: ['message'],
      },
    },
    {
      type: 'function',
      name: 'vault_read',
      description: 'Read a note from the Obsidian vault by relative path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Vault-relative path e.g. 01_active_projects.md' },
        },
        required: ['path'],
      },
    },
    {
      type: 'function',
      name: 'vault_append',
      description: 'Append a line/section to a vault note',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  ];
}

function splitCsv(s) {
  return String(s || '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseReplaceMap(text) {
  const out = {};
  String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const i = line.indexOf('=');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
  return out;
}

/**
 * Build xAI session.update.session object from merged voice agent settings
 */
export function buildXaiSessionConfig(settings = {}, systemInstructions = '') {
  const s = { ...DEFAULT_VOICE_AGENT, ...settings };
  const voice = (s.customVoiceId && String(s.customVoiceId).trim()) || s.voice || 'eve';
  const tools = [];

  if (s.tools?.webSearch) {
    const ws = s.webSearch || {};
    const t = { type: 'web_search' };
    const allowed = splitCsv(ws.allowedDomains);
    const excluded = splitCsv(ws.excludedDomains);
    if (allowed.length) t.allowed_domains = allowed;
    if (excluded.length) t.excluded_domains = excluded;
    if (ws.enableImageUnderstanding) t.enable_image_understanding = true;
    if (ws.country || ws.city) {
      t.location = {};
      if (ws.country) t.location.country = ws.country;
      if (ws.city) t.location.city = ws.city;
    }
    tools.push(t);
  }

  if (s.tools?.xSearch) {
    const xs = s.xSearch || {};
    const t = { type: 'x_search' };
    const allowed = splitCsv(xs.allowedHandles);
    const excluded = splitCsv(xs.excludedHandles);
    if (allowed.length) t.allowed_x_handles = allowed;
    if (excluded.length) t.excluded_x_handles = excluded;
    if (xs.fromDate) t.from_date = xs.fromDate;
    if (xs.toDate) t.to_date = xs.toDate;
    if (xs.enableImageUnderstanding) t.enable_image_understanding = true;
    if (xs.enableVideoUnderstanding) t.enable_video_understanding = true;
    tools.push(t);
  }

  if (s.tools?.fileSearch) {
    const fs = s.fileSearch || {};
    const ids = splitCsv(fs.vectorStoreIds);
    if (ids.length) {
      tools.push({
        type: 'file_search',
        vector_store_ids: ids,
        max_num_results: Number(fs.maxNumResults) || 8,
      });
    }
  }

  // MCP connectors
  const mcps = Array.isArray(s.mcpServers) ? s.mcpServers : [];
  for (const m of mcps) {
    if (!m?.server_url || !m?.server_label) continue;
    const tool = {
      type: 'mcp',
      server_url: m.server_url,
      server_label: m.server_label,
    };
    if (m.server_description) tool.server_description = m.server_description;
    if (m.authorization) tool.authorization = m.authorization;
    if (m.allowed_tools) {
      tool.allowed_tools = Array.isArray(m.allowed_tools)
        ? m.allowed_tools
        : splitCsv(m.allowed_tools);
    }
    if (m.headers && typeof m.headers === 'object') tool.headers = m.headers;
    tools.push(tool);
  }

  if (s.tools?.boardroomFunctions !== false) {
    tools.push(...boardroomFunctionTools());
  }

  const rate = Number(s.sampleRate) || 24000;
  const session = {
    instructions:
      (s.instructions && String(s.instructions).trim()) ||
      systemInstructions ||
      'You are JARVIS, voice chief of staff for AI Boardroom. Be concise, proactive, and British.',
    voice,
    tools,
    audio: {
      input: {
        format: { type: 'audio/pcm', rate },
        transport: 'json',
        transcription: {
          language_hint: s.languageHint || 'en',
        },
      },
      output: {
        format: { type: 'audio/pcm', rate },
        transport: 'json',
        speed: Math.min(1.5, Math.max(0.7, Number(s.outputSpeed) || 1)),
      },
    },
  };

  // reasoning.effort as nested key — docs use "reasoning.effort" as field name in session
  // Some APIs want nested; query param also supports it. Set nested if possible.
  session.reasoning = { effort: s.reasoningEffort === 'none' ? 'none' : 'high' };

  if (s.vadEnabled !== false) {
    session.turn_detection = {
      type: 'server_vad',
      threshold: Number(s.vadThreshold) || 0.85,
      silence_duration_ms: Number(s.silenceDurationMs) || 700,
      prefix_padding_ms: Number(s.prefixPaddingMs) || 333,
    };
    const idle = Number(s.idleTimeoutMs);
    if (idle > 0) session.turn_detection.idle_timeout_ms = idle;
  } else {
    session.turn_detection = null;
  }

  const replace = parseReplaceMap(s.replaceMap);
  if (Object.keys(replace).length) session.replace = replace;

  return session;
}

export default {
  XAI_VOICE_MODELS,
  XAI_BUILTIN_VOICES,
  DEFAULT_VOICE_AGENT,
  boardroomFunctionTools,
  buildXaiSessionConfig,
};
