/**
 * settings.js — Setup checklist, provider keys, connectors, Grok Voice Agent
 * All secrets stay in localStorage on THIS browser only. Nothing is public.
 */

const STORAGE_KEY = 'ai_boardroom_settings_v2';

const DEFAULT_VOICE_AGENT = {
  provider: 'xai',
  model: 'grok-voice-latest',
  voice: 'eve',
  customVoiceId: '',
  instructions: '',
  reasoningEffort: 'high',
  outputSpeed: 1.0,
  languageHint: 'en',
  greetOnConnect: true,
  greetText: 'Hello Sir — Boardroom voice online. How can I help?',
  vadEnabled: true,
  vadThreshold: 0.85,
  silenceDurationMs: 700,
  prefixPaddingMs: 333,
  idleTimeoutMs: 0,
  sampleRate: 24000,
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
    vectorStoreIds: '',
    maxNumResults: 8,
  },
  mcpServers: [],
  replaceMap: '',
};

/** Optional cloud connectors — ALL off by default, never auto-linked */
const DEFAULT_CONNECTORS = {
  gmail: { enabled: false, note: '', tokenHint: '' },
  googleDrive: { enabled: false, note: '', tokenHint: '' },
  googleCalendar: { enabled: false, note: '', tokenHint: '' },
  github: { enabled: false, note: '', tokenHint: '' },
};

const DEFAULTS = {
  providerKeys: {
    nvidia: '',
    openrouter: '',
    openai: '',
    anthropic: '',
    google: '',
    xai: '',
  },
  roleModels: {},
  voiceProvider: 'xai',
  globalProvider: 'nvidia',
  globalModel: '',
  voiceAgent: structuredClone(DEFAULT_VOICE_AGENT),
  connectors: structuredClone(DEFAULT_CONNECTORS),
  checklistDismissed: false,
  privacyAck: false,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      providerKeys: { ...DEFAULTS.providerKeys, ...(parsed.providerKeys || {}) },
      voiceAgent: {
        ...structuredClone(DEFAULT_VOICE_AGENT),
        ...(parsed.voiceAgent || {}),
        tools: { ...DEFAULT_VOICE_AGENT.tools, ...(parsed.voiceAgent?.tools || {}) },
        webSearch: { ...DEFAULT_VOICE_AGENT.webSearch, ...(parsed.voiceAgent?.webSearch || {}) },
        xSearch: { ...DEFAULT_VOICE_AGENT.xSearch, ...(parsed.voiceAgent?.xSearch || {}) },
        fileSearch: { ...DEFAULT_VOICE_AGENT.fileSearch, ...(parsed.voiceAgent?.fileSearch || {}) },
      },
      connectors: {
        ...structuredClone(DEFAULT_CONNECTORS),
        ...(parsed.connectors || {}),
        gmail: { ...DEFAULT_CONNECTORS.gmail, ...(parsed.connectors?.gmail || {}) },
        googleDrive: { ...DEFAULT_CONNECTORS.googleDrive, ...(parsed.connectors?.googleDrive || {}) },
        googleCalendar: { ...DEFAULT_CONNECTORS.googleCalendar, ...(parsed.connectors?.googleCalendar || {}) },
        github: { ...DEFAULT_CONNECTORS.github, ...(parsed.connectors?.github || {}) },
      },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function save(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('boardroom:settings', { detail: state }));
}

function getSettings() {
  return load();
}

function getProviderKeysHeader() {
  const { providerKeys } = load();
  const cleaned = {};
  for (const [k, v] of Object.entries(providerKeys || {})) {
    if (v && String(v).trim()) cleaned[k] = String(v).trim();
  }
  if (!Object.keys(cleaned).length) return {};
  return {
    'X-Provider-Keys': btoa(unescape(encodeURIComponent(JSON.stringify(cleaned)))),
  };
}

function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...getProviderKeysHeader() },
  });
}

function disconnectAll() {
  localStorage.removeItem(STORAGE_KEY);
  // Also clear any legacy keys
  try {
    localStorage.removeItem('ai_boardroom_settings');
    localStorage.removeItem('ai_boardroom_keys');
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem('openai_api_key');
    localStorage.removeItem('xai_api_key');
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('boardroom:settings', { detail: load() }));
}

function checklistState(state) {
  const k = state.providerKeys || {};
  const c = state.connectors || {};
  const steps = [
    {
      id: 'privacy',
      title: 'Privacy basics',
      detail: 'Confirm nothing is auto-linked. Paperclip = local device files only.',
      done: !!state.privacyAck,
      action: 'ack-privacy',
    },
    {
      id: 'nvidia',
      title: 'NVIDIA NIM (primary chat)',
      detail: 'Get a key at build.nvidia.com → paste below → Test NVIDIA.',
      done: !!(k.nvidia && String(k.nvidia).trim()),
      href: 'https://build.nvidia.com',
    },
    {
      id: 'xai',
      title: 'xAI Grok + Voice',
      detail: 'console.x.ai → API key with Voice/Realtime → paste under xAI → Test Voice.',
      done: !!(k.xai && String(k.xai).trim()),
      href: 'https://console.x.ai',
    },
    {
      id: 'openai',
      title: 'ChatGPT / OpenAI (optional)',
      detail: 'platform.openai.com → API keys. Enables GPT models + Realtime voice fallback.',
      done: !!(k.openai && String(k.openai).trim()),
      href: 'https://platform.openai.com/api-keys',
    },
    {
      id: 'anthropic',
      title: 'Claude / Anthropic (optional)',
      detail: 'console.anthropic.com → API keys for Claude board members.',
      done: !!(k.anthropic && String(k.anthropic).trim()),
      href: 'https://console.anthropic.com',
    },
    {
      id: 'google_llm',
      title: 'Gemini API key (optional)',
      detail: 'aistudio.google.com → API key. This is Gemini LLM only — not Gmail/Drive.',
      done: !!(k.google && String(k.google).trim()),
      href: 'https://aistudio.google.com/apikey',
    },
    {
      id: 'openrouter',
      title: 'OpenRouter free models (optional fallback)',
      detail: 'openrouter.ai/keys — free community models when NVIDIA is busy.',
      done: !!(k.openrouter && String(k.openrouter).trim()),
      href: 'https://openrouter.ai/keys',
    },
    {
      id: 'gmail',
      title: 'Gmail connector (optional · off by default)',
      detail: 'Only enable if you paste your own access token. Never auto-connected.',
      done: !!(c.gmail?.enabled && c.gmail?.tokenHint),
    },
    {
      id: 'drive',
      title: 'Google Drive connector (optional · off by default)',
      detail: 'Off by default. Attach button does NOT use Drive. Enable only with your token.',
      done: !!(c.googleDrive?.enabled && c.googleDrive?.tokenHint),
    },
    {
      id: 'calendar',
      title: 'Google Calendar (optional · off by default)',
      detail: 'Off by default. Requires your own Google OAuth token.',
      done: !!(c.googleCalendar?.enabled && c.googleCalendar?.tokenHint),
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length };
}

async function initSettings() {
  const btn = document.getElementById('settingsBtn');
  const modal = document.getElementById('settingsModal');
  const closeBtn = document.getElementById('settingsClose');
  if (!btn || !modal) return;

  btn.addEventListener('click', () => {
    modal.hidden = false;
    renderSettings();
  });
  closeBtn?.addEventListener('click', () => {
    modal.hidden = true;
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });

  document.getElementById('settingsSave')?.addEventListener('click', () => {
    const state = collectForm();
    save(state);
    const status = document.getElementById('settingsStatus');
    if (status) {
      status.textContent = 'Saved on this device only';
      setTimeout(() => (status.textContent = ''), 2500);
    }
    window.__boardroom?.reloadStatus?.();
    window.__boardroom?.loadBoardMembers?.();
    renderSettings();
  });

  document.getElementById('settingsDisconnectAll')?.addEventListener('click', () => {
    if (!confirm('Clear ALL API keys and connectors from this browser? This cannot be undone.')) return;
    disconnectAll();
    const status = document.getElementById('settingsStatus');
    if (status) status.textContent = 'Disconnected — all local secrets cleared';
    window.__boardroom?.reloadStatus?.();
    renderSettings();
  });

  document.getElementById('settingsTestNvidia')?.addEventListener('click', async () => {
    const state = collectForm();
    save(state);
    const status = document.getElementById('settingsStatus');
    if (status) status.textContent = 'Testing NVIDIA key…';
    try {
      const res = await fetch('/api/settings/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'nvidia',
          apiKey: state.providerKeys.nvidia,
          model: state.globalModel || undefined,
        }),
      });
      const data = await res.json();
      if (status) status.textContent = data.ok ? `NVIDIA OK · ${data.model}` : `Fail: ${data.error}`;
    } catch (e) {
      if (status) status.textContent = e.message;
    }
  });

  document.getElementById('settingsTestVoice')?.addEventListener('click', async () => {
    const state = collectForm();
    save(state);
    const status = document.getElementById('settingsStatus');
    if (status) status.textContent = 'Requesting xAI voice token…';
    try {
      const res = await fetch('/api/voice/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProviderKeysHeader() },
        body: JSON.stringify({
          provider: state.voiceProvider || 'xai',
          voiceAgent: state.voiceAgent,
        }),
      });
      const data = await res.json();
      if (status) {
        status.textContent = res.ok
          ? `Voice OK · ${data.provider} · ${data.model || data.protocol}`
          : `Voice fail: ${data.message || data.error}`;
      }
    } catch (e) {
      if (status) status.textContent = e.message;
    }
  });

  // Delegated clicks inside settings body (checklist / connectors)
  document.getElementById('settingsBody')?.addEventListener('click', (e) => {
    const ack = e.target.closest('[data-ack-privacy]');
    if (ack) {
      const state = collectForm();
      state.privacyAck = true;
      save(state);
      renderSettings();
      return;
    }
    const disc = e.target.closest('[data-disconnect-connector]');
    if (disc) {
      const id = disc.getAttribute('data-disconnect-connector');
      const state = collectForm();
      if (state.connectors?.[id]) {
        state.connectors[id] = { enabled: false, note: '', tokenHint: '' };
        save(state);
        renderSettings();
      }
    }
  });
}

function collectForm() {
  const state = load();
  for (const id of Object.keys(state.providerKeys)) {
    const el = document.getElementById(`key_${id}`);
    if (el) state.providerKeys[id] = el.value.trim();
  }
  const voice = document.getElementById('voiceProviderSelect');
  if (voice) state.voiceProvider = voice.value;
  const gp = document.getElementById('globalProviderSelect');
  if (gp) state.globalProvider = gp.value;
  const gm = document.getElementById('globalModelSelect');
  if (gm) state.globalModel = gm.value;

  document.querySelectorAll('[data-role-model]').forEach((sel) => {
    const role = sel.dataset.roleModel;
    const val = sel.value;
    if (!val) {
      delete state.roleModels[role];
      return;
    }
    const [provider, ...rest] = val.split('::');
    state.roleModels[role] = { provider, model: rest.join('::') };
  });

  // Connectors
  state.connectors = state.connectors || structuredClone(DEFAULT_CONNECTORS);
  for (const id of Object.keys(DEFAULT_CONNECTORS)) {
    const en = document.getElementById(`conn_${id}_enabled`);
    const token = document.getElementById(`conn_${id}_token`);
    const note = document.getElementById(`conn_${id}_note`);
    state.connectors[id] = {
      enabled: !!en?.checked,
      tokenHint: token?.value?.trim() || '',
      note: note?.value?.trim() || '',
    };
  }

  const privacy = document.getElementById('privacyAckCheck');
  if (privacy) state.privacyAck = privacy.checked;

  // Voice agent suite
  const va = state.voiceAgent || structuredClone(DEFAULT_VOICE_AGENT);
  const g = (id) => document.getElementById(id);
  if (g('va_model')) va.model = g('va_model').value;
  if (g('va_voice')) va.voice = g('va_voice').value;
  if (g('va_customVoiceId')) va.customVoiceId = g('va_customVoiceId').value.trim();
  if (g('va_instructions')) va.instructions = g('va_instructions').value;
  if (g('va_reasoningEffort')) va.reasoningEffort = g('va_reasoningEffort').value;
  if (g('va_outputSpeed')) va.outputSpeed = Number(g('va_outputSpeed').value) || 1;
  if (g('va_languageHint')) va.languageHint = g('va_languageHint').value.trim() || 'en';
  if (g('va_greetOnConnect')) va.greetOnConnect = g('va_greetOnConnect').checked;
  if (g('va_greetText')) va.greetText = g('va_greetText').value;
  if (g('va_vadEnabled')) va.vadEnabled = g('va_vadEnabled').checked;
  if (g('va_vadThreshold')) va.vadThreshold = Number(g('va_vadThreshold').value);
  if (g('va_silenceDurationMs')) va.silenceDurationMs = Number(g('va_silenceDurationMs').value);
  if (g('va_prefixPaddingMs')) va.prefixPaddingMs = Number(g('va_prefixPaddingMs').value);
  if (g('va_idleTimeoutMs')) va.idleTimeoutMs = Number(g('va_idleTimeoutMs').value);
  if (g('va_sampleRate')) va.sampleRate = Number(g('va_sampleRate').value);

  va.tools = va.tools || {};
  if (g('va_tool_web')) va.tools.webSearch = g('va_tool_web').checked;
  if (g('va_tool_x')) va.tools.xSearch = g('va_tool_x').checked;
  if (g('va_tool_file')) va.tools.fileSearch = g('va_tool_file').checked;
  if (g('va_tool_board')) va.tools.boardroomFunctions = g('va_tool_board').checked;

  va.webSearch = va.webSearch || {};
  if (g('va_ws_allowed')) va.webSearch.allowedDomains = g('va_ws_allowed').value;
  if (g('va_ws_excluded')) va.webSearch.excludedDomains = g('va_ws_excluded').value;
  if (g('va_ws_images')) va.webSearch.enableImageUnderstanding = g('va_ws_images').checked;
  if (g('va_ws_country')) va.webSearch.country = g('va_ws_country').value.trim();
  if (g('va_ws_city')) va.webSearch.city = g('va_ws_city').value.trim();

  va.xSearch = va.xSearch || {};
  if (g('va_xs_allowed')) va.xSearch.allowedHandles = g('va_xs_allowed').value;
  if (g('va_xs_excluded')) va.xSearch.excludedHandles = g('va_xs_excluded').value;
  if (g('va_xs_from')) va.xSearch.fromDate = g('va_xs_from').value;
  if (g('va_xs_to')) va.xSearch.toDate = g('va_xs_to').value;
  if (g('va_xs_images')) va.xSearch.enableImageUnderstanding = g('va_xs_images').checked;
  if (g('va_xs_video')) va.xSearch.enableVideoUnderstanding = g('va_xs_video').checked;

  va.fileSearch = va.fileSearch || {};
  if (g('va_fs_ids')) va.fileSearch.vectorStoreIds = g('va_fs_ids').value;
  if (g('va_fs_max')) va.fileSearch.maxNumResults = Number(g('va_fs_max').value) || 8;

  if (g('va_mcp_json')) {
    try {
      const raw = g('va_mcp_json').value.trim();
      va.mcpServers = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(va.mcpServers)) va.mcpServers = [];
    } catch { /* keep */ }
  }
  if (g('va_replaceMap')) va.replaceMap = g('va_replaceMap').value;
  va.provider = state.voiceProvider || 'xai';
  state.voiceAgent = va;
  return state;
}

async function renderSettings() {
  const state = load();
  const body = document.getElementById('settingsBody');
  if (!body) return;

  let catalog = { providers: [] };
  let voiceOpts = null;
  try {
    catalog = await (await apiFetch('/api/models')).json();
  } catch { /* */ }
  try {
    voiceOpts = await (await apiFetch('/api/voice/options')).json();
  } catch {
    voiceOpts = {
      models: [
        { id: 'grok-voice-latest', name: 'Grok Voice Latest' },
        { id: 'grok-voice-think-fast-2.0', name: 'Think Fast 2.0' },
        { id: 'grok-voice-think-fast-1.0', name: 'Think Fast 1.0' },
      ],
      voices: [
        { id: 'eve', name: 'Eve' },
        { id: 'ara', name: 'Ara' },
        { id: 'rex', name: 'Rex' },
        { id: 'sal', name: 'Sal' },
        { id: 'leo', name: 'Leo' },
      ],
      boardroomTools: [],
    };
  }

  const { steps, done, total } = checklistState(state);
  const pct = Math.round((done / total) * 100);

  const checklistHtml = `
    <section class="settings-section settings-section--checklist">
      <h3>Setup checklist</h3>
      <p class="settings-help">Follow these steps to activate the boardroom. <strong>Nothing is connected until you paste a key or enable a connector on this device.</strong></p>
      <div class="checklist-progress">
        <div class="checklist-progress-bar" style="width:${pct}%"></div>
      </div>
      <div class="checklist-meta">${done} / ${total} complete · ${pct}%</div>
      <ol class="setup-checklist">
        ${steps
          .map(
            (s, i) => `
          <li class="setup-step ${s.done ? 'is-done' : ''}">
            <span class="setup-step-num">${s.done ? '✓' : i + 1}</span>
            <div class="setup-step-body">
              <strong>${escapeHtml(s.title)}</strong>
              <p>${escapeHtml(s.detail)}</p>
              <div class="setup-step-actions">
                ${s.href ? `<a class="settings-link" href="${escapeAttr(s.href)}" target="_blank" rel="noopener">Open site</a>` : ''}
                ${s.action === 'ack-privacy' && !s.done ? `<button type="button" class="settings-btn settings-btn--sm" data-ack-privacy>I understand — nothing is public</button>` : ''}
                ${s.action === 'ack-privacy' && s.done ? `<span class="settings-badge settings-badge--ready">Acknowledged</span>` : ''}
              </div>
            </div>
          </li>`
          )
          .join('')}
      </ol>
      <div class="privacy-banner">
        <label class="settings-check">
          <input type="checkbox" id="privacyAckCheck" ${state.privacyAck ? 'checked' : ''}/>
          I understand: API keys stay in my browser; Google Drive/Gmail are OFF unless I enable them below; paperclip only opens local files.
        </label>
      </div>
    </section>`;

  const providerBlocks = (catalog.providers || [])
    .map((p) => {
      const val = state.providerKeys[p.id] || '';
      const badge = p.configured || val ? 'ready' : 'empty';
      const guides = {
        nvidia: 'build.nvidia.com',
        openrouter: 'openrouter.ai/keys',
        openai: 'platform.openai.com/api-keys',
        anthropic: 'console.anthropic.com',
        google: 'aistudio.google.com/apikey (Gemini only — not Drive)',
        xai: 'console.x.ai',
      };
      return `
        <div class="settings-card" id="card_${p.id}">
          <div class="settings-card-head">
            <span class="settings-provider-dot" style="background:${p.color || '#888'}"></span>
            <div>
              <strong>${escapeHtml(p.name)}${p.primary ? ' · Primary chat' : ''}</strong>
              <p>${escapeHtml(p.description || '')}</p>
              <p class="settings-guide">Guide: ${escapeHtml(guides[p.id] || p.envKey || '')}</p>
            </div>
            <span class="settings-badge settings-badge--${badge}">${badge === 'ready' ? 'Keyed' : 'Empty'}</span>
          </div>
          <label class="settings-label">API Key (${escapeHtml(p.envKey || p.id)})</label>
          <input class="settings-input" id="key_${p.id}" type="password" autocomplete="off"
            placeholder="Paste key — stored only in this browser"
            value="${escapeAttr(val)}" />
        </div>`;
    })
    .join('');

  const roles = ['jarvis', 'architect', 'coder', 'creative', 'analyst', 'product', 'devops', 'security', 'qa'];
  const roleRowsFixed = roles
    .map((role) => {
      const pref = state.roleModels[role];
      const current = pref ? `${pref.provider}::${pref.model}` : '';
      const opts = (catalog.providers || [])
        .flatMap((p) =>
          (p.models || []).map((m) => {
            const v = `${p.id}::${m.id}`;
            return `<option value="${escapeAttr(v)}" ${v === current ? 'selected' : ''}>${escapeHtml(p.name)} · ${escapeHtml(m.name || m.id)}</option>`;
          })
        )
        .join('');
      return `
        <div class="settings-role-row">
          <span class="settings-role-name">${escapeHtml(role)}</span>
          <select class="settings-select" data-role-model="${role}">
            <option value="">Default (NVIDIA stack)</option>
            ${opts}
          </select>
        </div>`;
    })
    .join('');

  const nvidiaModels = (catalog.providers || []).find((p) => p.id === 'nvidia')?.models || [];
  const nvidiaOpts = nvidiaModels
    .map(
      (m) =>
        `<option value="${escapeAttr(m.id)}" ${state.globalModel === m.id ? 'selected' : ''}>${escapeHtml(m.name || m.id)}</option>`
    )
    .join('');

  const connMeta = [
    {
      id: 'gmail',
      name: 'Gmail',
      help: 'Optional. Paste a personal OAuth access token only if you want mail tools. Off = disconnected.',
    },
    {
      id: 'googleDrive',
      name: 'Google Drive',
      help: 'OFF by default. The paperclip never uses Drive. Only enable with your own token if you need Drive tools later.',
    },
    {
      id: 'googleCalendar',
      name: 'Google Calendar',
      help: 'Optional calendar access. Requires your own Google OAuth token.',
    },
    {
      id: 'github',
      name: 'GitHub',
      help: 'Optional personal access token for repo tools (classic or fine-grained).',
    },
  ];

  const connectorsHtml = connMeta
    .map((c) => {
      const cur = state.connectors?.[c.id] || { enabled: false, tokenHint: '', note: '' };
      return `
        <div class="connector-card ${cur.enabled ? 'is-on' : 'is-off'}">
          <div class="connector-card-head">
            <strong>${escapeHtml(c.name)}</strong>
            <span class="settings-badge settings-badge--${cur.enabled && cur.tokenHint ? 'ready' : 'empty'}">
              ${cur.enabled && cur.tokenHint ? 'Enabled' : 'Disconnected'}
            </span>
          </div>
          <p class="settings-help">${escapeHtml(c.help)}</p>
          <label class="settings-check">
            <input type="checkbox" id="conn_${c.id}_enabled" ${cur.enabled ? 'checked' : ''}/>
            Enable ${escapeHtml(c.name)} for this browser only
          </label>
          <label class="settings-label">Access token (optional · never shared publicly)</label>
          <input class="settings-input" id="conn_${c.id}_token" type="password" autocomplete="off"
            placeholder="Leave empty = disconnected"
            value="${escapeAttr(cur.tokenHint || '')}" />
          <label class="settings-label">Note (optional)</label>
          <input class="settings-input" id="conn_${c.id}_note" type="text"
            placeholder="e.g. personal workspace"
            value="${escapeAttr(cur.note || '')}" />
          <button type="button" class="settings-btn settings-btn--sm settings-btn--danger" data-disconnect-connector="${c.id}">
            Disconnect ${escapeHtml(c.name)}
          </button>
        </div>`;
    })
    .join('');

  const va = state.voiceAgent || DEFAULT_VOICE_AGENT;
  const modelOpts = (voiceOpts.models || [])
    .map(
      (m) =>
        `<option value="${escapeAttr(m.id)}" ${va.model === m.id ? 'selected' : ''}>${escapeHtml(m.name || m.id)}</option>`
    )
    .join('');
  const voiceOptsHtml = (voiceOpts.voices || [])
    .map(
      (v) =>
        `<option value="${escapeAttr(v.id)}" ${va.voice === v.id ? 'selected' : ''}>${escapeHtml(v.name || v.id)}${v.note ? ' · ' + escapeHtml(v.note) : ''}</option>`
    )
    .join('');
  const boardToolsList = (voiceOpts.boardroomTools || [])
    .map((t) => `<li><code>${escapeHtml(t.name)}</code> — ${escapeHtml(t.description || '')}</li>`)
    .join('');
  const mcpJson = JSON.stringify(va.mcpServers || [], null, 2);

  body.innerHTML = `
    ${checklistHtml}

    <section class="settings-section">
      <h3>1 · Provider API keys</h3>
      <p class="settings-help">Keys stay in <strong>this browser only</strong>. They are sent to your boardroom server only when you chat/voice — never published.</p>
      <div class="settings-grid">${providerBlocks}</div>
    </section>

    <section class="settings-section">
      <h3>2 · Default chat model</h3>
      <div class="settings-inline">
        <select class="settings-select" id="globalProviderSelect">
          <option value="nvidia" ${state.globalProvider === 'nvidia' ? 'selected' : ''}>NVIDIA NIM</option>
          <option value="openrouter" ${state.globalProvider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
          <option value="openai" ${state.globalProvider === 'openai' ? 'selected' : ''}>OpenAI / ChatGPT</option>
          <option value="anthropic" ${state.globalProvider === 'anthropic' ? 'selected' : ''}>Anthropic / Claude</option>
          <option value="google" ${state.globalProvider === 'google' ? 'selected' : ''}>Gemini</option>
          <option value="xai" ${state.globalProvider === 'xai' ? 'selected' : ''}>xAI Grok</option>
        </select>
        <select class="settings-select" id="globalModelSelect">
          <option value="">Auto (role defaults)</option>
          ${nvidiaOpts}
        </select>
      </div>
    </section>

    <section class="settings-section">
      <h3>3 · Board member models</h3>
      <div class="settings-roles">${roleRowsFixed}</div>
    </section>

    <section class="settings-section">
      <h3>4 · Cloud connectors (all disconnected by default)</h3>
      <p class="settings-help privacy-strong">
        Google Drive, Gmail, and Calendar are <strong>not</strong> linked to this app for anyone.
        Enabling a connector only stores a token in your browser. Use <em>Disconnect all</em> anytime.
      </p>
      <div class="connectors-grid">${connectorsHtml}</div>
    </section>

    <section class="settings-section settings-section--voice">
      <h3>5 · Grok Voice Agent</h3>
      <p class="settings-help">Live speech-to-speech. Needs xAI key from step 1.</p>

      <label class="settings-label">Voice engine</label>
      <select class="settings-select" id="voiceProviderSelect">
        <option value="xai" ${state.voiceProvider === 'xai' ? 'selected' : ''}>Grok Voice Agent (xAI) · recommended</option>
        <option value="openai" ${state.voiceProvider === 'openai' ? 'selected' : ''}>ChatGPT Voice (Realtime)</option>
        <option value="gemini" ${state.voiceProvider === 'gemini' ? 'selected' : ''}>Gemini Live</option>
      </select>

      <div class="settings-inline" style="margin-top:12px">
        <div>
          <label class="settings-label">Voice model</label>
          <select class="settings-select" id="va_model">${modelOpts}</select>
        </div>
        <div>
          <label class="settings-label">Voice persona</label>
          <select class="settings-select" id="va_voice">${voiceOptsHtml}</select>
        </div>
      </div>

      <label class="settings-label">Custom voice ID (optional)</label>
      <input class="settings-input" id="va_customVoiceId" type="text" placeholder="voice_id from console.x.ai"
        value="${escapeAttr(va.customVoiceId || '')}" />

      <label class="settings-label">System prompt / instructions</label>
      <textarea class="settings-input settings-textarea" id="va_instructions" rows="4"
        placeholder="You are JARVIS…">${escapeHtml(va.instructions || '')}</textarea>

      <div class="settings-inline">
        <div>
          <label class="settings-label">Reasoning effort</label>
          <select class="settings-select" id="va_reasoningEffort">
            <option value="high" ${va.reasoningEffort === 'high' ? 'selected' : ''}>High</option>
            <option value="none" ${va.reasoningEffort === 'none' ? 'selected' : ''}>None</option>
          </select>
        </div>
        <div>
          <label class="settings-label">Speech speed</label>
          <input class="settings-input" id="va_outputSpeed" type="number" min="0.7" max="1.5" step="0.05"
            value="${escapeAttr(va.outputSpeed ?? 1)}" />
        </div>
        <div>
          <label class="settings-label">Language hint</label>
          <input class="settings-input" id="va_languageHint" type="text" value="${escapeAttr(va.languageHint || 'en')}" />
        </div>
        <div>
          <label class="settings-label">Sample rate</label>
          <select class="settings-select" id="va_sampleRate">
            ${[16000, 24000, 48000]
              .map((r) => `<option value="${r}" ${(va.sampleRate || 24000) === r ? 'selected' : ''}>${r} Hz</option>`)
              .join('')}
          </select>
        </div>
      </div>

      <div class="settings-check-row">
        <label class="settings-check"><input type="checkbox" id="va_greetOnConnect" ${va.greetOnConnect !== false ? 'checked' : ''}/> Greet on connect</label>
      </div>
      <label class="settings-label">Greeting prompt</label>
      <input class="settings-input" id="va_greetText" type="text" value="${escapeAttr(va.greetText || '')}" />

      <h4 class="settings-subhead">Turn detection (server VAD)</h4>
      <div class="settings-check-row">
        <label class="settings-check"><input type="checkbox" id="va_vadEnabled" ${va.vadEnabled !== false ? 'checked' : ''}/> Enable server VAD</label>
      </div>
      <div class="settings-inline">
        <div>
          <label class="settings-label">VAD threshold</label>
          <input class="settings-input" id="va_vadThreshold" type="number" min="0.1" max="0.9" step="0.05" value="${escapeAttr(va.vadThreshold ?? 0.85)}" />
        </div>
        <div>
          <label class="settings-label">Silence (ms)</label>
          <input class="settings-input" id="va_silenceDurationMs" type="number" min="0" max="10000" step="50" value="${escapeAttr(va.silenceDurationMs ?? 700)}" />
        </div>
        <div>
          <label class="settings-label">Prefix padding (ms)</label>
          <input class="settings-input" id="va_prefixPaddingMs" type="number" min="0" max="10000" step="10" value="${escapeAttr(va.prefixPaddingMs ?? 333)}" />
        </div>
        <div>
          <label class="settings-label">Idle timeout (ms)</label>
          <input class="settings-input" id="va_idleTimeoutMs" type="number" min="0" max="120000" step="500" value="${escapeAttr(va.idleTimeoutMs ?? 0)}" />
        </div>
      </div>

      <h4 class="settings-subhead">Built-in voice tools</h4>
      <div class="settings-check-grid">
        <label class="settings-check"><input type="checkbox" id="va_tool_web" ${va.tools?.webSearch !== false ? 'checked' : ''}/> Web Search</label>
        <label class="settings-check"><input type="checkbox" id="va_tool_x" ${va.tools?.xSearch !== false ? 'checked' : ''}/> X Search</label>
        <label class="settings-check"><input type="checkbox" id="va_tool_file" ${va.tools?.fileSearch ? 'checked' : ''}/> Collections search</label>
        <label class="settings-check"><input type="checkbox" id="va_tool_board" ${va.tools?.boardroomFunctions !== false ? 'checked' : ''}/> Boardroom functions</label>
      </div>

      <h4 class="settings-subhead">Web Search options</h4>
      <div class="settings-inline">
        <div>
          <label class="settings-label">Allowed domains</label>
          <input class="settings-input" id="va_ws_allowed" value="${escapeAttr(va.webSearch?.allowedDomains || '')}" />
        </div>
        <div>
          <label class="settings-label">Excluded domains</label>
          <input class="settings-input" id="va_ws_excluded" value="${escapeAttr(va.webSearch?.excludedDomains || '')}" />
        </div>
        <div>
          <label class="settings-label">Country</label>
          <input class="settings-input" id="va_ws_country" value="${escapeAttr(va.webSearch?.country || '')}" />
        </div>
        <div>
          <label class="settings-label">City</label>
          <input class="settings-input" id="va_ws_city" value="${escapeAttr(va.webSearch?.city || '')}" />
        </div>
      </div>
      <label class="settings-check"><input type="checkbox" id="va_ws_images" ${va.webSearch?.enableImageUnderstanding !== false ? 'checked' : ''}/> Image understanding</label>

      <h4 class="settings-subhead">X Search options</h4>
      <div class="settings-inline">
        <div>
          <label class="settings-label">Allowed handles</label>
          <input class="settings-input" id="va_xs_allowed" value="${escapeAttr(va.xSearch?.allowedHandles || '')}" />
        </div>
        <div>
          <label class="settings-label">Excluded handles</label>
          <input class="settings-input" id="va_xs_excluded" value="${escapeAttr(va.xSearch?.excludedHandles || '')}" />
        </div>
        <div>
          <label class="settings-label">From date</label>
          <input class="settings-input" id="va_xs_from" type="date" value="${escapeAttr(va.xSearch?.fromDate || '')}" />
        </div>
        <div>
          <label class="settings-label">To date</label>
          <input class="settings-input" id="va_xs_to" type="date" value="${escapeAttr(va.xSearch?.toDate || '')}" />
        </div>
      </div>
      <div class="settings-check-row">
        <label class="settings-check"><input type="checkbox" id="va_xs_images" ${va.xSearch?.enableImageUnderstanding !== false ? 'checked' : ''}/> Images</label>
        <label class="settings-check"><input type="checkbox" id="va_xs_video" ${va.xSearch?.enableVideoUnderstanding ? 'checked' : ''}/> Video</label>
      </div>

      <h4 class="settings-subhead">Collections / File Search</h4>
      <label class="settings-label">Collection IDs</label>
      <input class="settings-input" id="va_fs_ids" value="${escapeAttr(va.fileSearch?.vectorStoreIds || '')}" />
      <label class="settings-label">Max results</label>
      <input class="settings-input" id="va_fs_max" type="number" min="1" max="50" value="${escapeAttr(va.fileSearch?.maxNumResults ?? 8)}" />

      <h4 class="settings-subhead">Remote MCP connectors</h4>
      <textarea class="settings-input settings-textarea settings-mono" id="va_mcp_json" rows="5">${escapeHtml(mcpJson)}</textarea>

      <h4 class="settings-subhead">Pronunciation map</h4>
      <textarea class="settings-input settings-textarea settings-mono" id="va_replaceMap" rows="3">${escapeHtml(va.replaceMap || '')}</textarea>

      <h4 class="settings-subhead">Boardroom function tools</h4>
      <ul class="settings-tool-list">${boardToolsList || '<li>read_file, write_file, consult_board, vault_*, …</li>'}</ul>
    </section>
  `;
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&')
    .replace(/"/g, '"')
    .replace(/</g, '<');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initSettings());
} else {
  initSettings();
}

window.__boardroomSettings = {
  getSettings,
  getProviderKeysHeader,
  apiFetch,
  load,
  save,
  disconnectAll,
};
