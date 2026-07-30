/**
 * settings.js — Provider keys, model catalog, per-role assignment, voice provider
 * Keys stay in localStorage; sent to API as X-Provider-Keys base64 header.
 */

const STORAGE_KEY = 'ai_boardroom_settings_v2';

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
  voiceProvider: 'gemini',
  globalProvider: 'nvidia',
  globalModel: '',
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return { ...structuredClone(DEFAULTS), ...JSON.parse(raw) };
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
  const headers = {
    ...(options.headers || {}),
    ...getProviderKeysHeader(),
  };
  return fetch(url, { ...options, headers });
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
      status.textContent = 'Saved locally';
      setTimeout(() => (status.textContent = ''), 2000);
    }
    window.__boardroom?.reloadStatus?.();
    window.__boardroom?.loadBoardMembers?.();
  });

  document.getElementById('settingsTestNvidia')?.addEventListener('click', async () => {
    const state = collectForm();
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
  return state;
}

async function renderSettings() {
  const state = load();
  const body = document.getElementById('settingsBody');
  if (!body) return;

  let catalog = null;
  try {
    const res = await apiFetch('/api/models');
    catalog = await res.json();
  } catch {
    catalog = { providers: [] };
  }

  const providerBlocks = (catalog.providers || [])
    .map((p) => {
      const val = state.providerKeys[p.id] || '';
      const badge = p.configured || val ? 'ready' : 'empty';
      return `
        <div class="settings-card">
          <div class="settings-card-head">
            <span class="settings-provider-dot" style="background:${p.color || '#888'}"></span>
            <div>
              <strong>${p.name}${p.primary ? ' · Primary' : ''}</strong>
              <p>${p.description || ''}</p>
            </div>
            <span class="settings-badge settings-badge--${badge}">${badge === 'ready' ? 'Keyed' : 'Empty'}</span>
          </div>
          <label class="settings-label">API Key (${p.envKey || p.id})</label>
          <input class="settings-input" id="key_${p.id}" type="password" autocomplete="off"
            placeholder="Paste key — stored only in this browser"
            value="${escapeAttr(val)}" />
        </div>`;
    })
    .join('');

  const allModelOptions = (catalog.providers || [])
    .flatMap((p) =>
      (p.models || []).map(
        (m) => `<option value="${p.id}::${m.id}">${p.name} · ${m.name || m.id}</option>`
      )
    )
    .join('');

  const roles = [
    'jarvis',
    'architect',
    'coder',
    'creative',
    'analyst',
    'product',
    'devops',
    'security',
    'qa',
  ];
  const roleRows = roles
    .map((role) => {
      const pref = state.roleModels[role];
      const current = pref ? `${pref.provider}::${pref.model}` : '';
      return `
        <div class="settings-role-row">
          <span class="settings-role-name">${role}</span>
          <select class="settings-select" data-role-model="${role}">
            <option value="">Default (NVIDIA stack)</option>
            ${allModelOptions.replace(
              `value="${current}"`,
              `value="${current}" selected`
            )}
          </select>
        </div>`;
    })
    .join('');

  // Fix selected attrs properly
  const roleRowsFixed = roles
    .map((role) => {
      const pref = state.roleModels[role];
      const current = pref ? `${pref.provider}::${pref.model}` : '';
      const opts = (catalog.providers || [])
        .flatMap((p) =>
          (p.models || []).map((m) => {
            const v = `${p.id}::${m.id}`;
            return `<option value="${v}" ${v === current ? 'selected' : ''}>${p.name} · ${m.name || m.id}</option>`;
          })
        )
        .join('');
      return `
        <div class="settings-role-row">
          <span class="settings-role-name">${role}</span>
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
        `<option value="${m.id}" ${state.globalModel === m.id ? 'selected' : ''}>${m.name || m.id}</option>`
    )
    .join('');

  body.innerHTML = `
    <section class="settings-section">
      <h3>Provider API Keys</h3>
      <p class="settings-help">Keys stay in your browser. NVIDIA NIM is the primary stack. OpenRouter free models are used as automatic fallback.</p>
      <div class="settings-grid">${providerBlocks}</div>
    </section>
    <section class="settings-section">
      <h3>Default chat model</h3>
      <div class="settings-inline">
        <select class="settings-select" id="globalProviderSelect">
          <option value="nvidia" ${state.globalProvider === 'nvidia' ? 'selected' : ''}>NVIDIA NIM</option>
          <option value="openrouter" ${state.globalProvider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
          <option value="openai" ${state.globalProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
          <option value="anthropic" ${state.globalProvider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
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
      <h3>Board member models</h3>
      <div class="settings-roles">${roleRowsFixed}</div>
    </section>
    <section class="settings-section">
      <h3>Voice engine</h3>
      <select class="settings-select" id="voiceProviderSelect">
        <option value="gemini" ${state.voiceProvider === 'gemini' ? 'selected' : ''}>Gemini Live</option>
        <option value="openai" ${state.voiceProvider === 'openai' ? 'selected' : ''}>ChatGPT Voice (Realtime)</option>
        <option value="xai" ${state.voiceProvider === 'xai' ? 'selected' : ''}>Grok Voice</option>
      </select>
    </section>
  `;
}

function escapeAttr(s) {
  return String(s || '')
    .replace(/&/g, '&')
    .replace(/"/g, '"')
    .replace(/</g, '<');
}

// auto-init if DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initSettings());
} else {
  initSettings();
}

window.__boardroomSettings = { getSettings, getProviderKeysHeader, apiFetch, load, save };
