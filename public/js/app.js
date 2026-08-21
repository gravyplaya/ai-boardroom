/**
 * app.js — AI Boardroom frontend v2.1
 * Streaming chat · stop/regenerate · a11y · polished composer
 */

const state = {
  activeRole: 'jarvis',
  sessionId: crypto.randomUUID(),
  isLoading: false,
  boardMembers: [],
  boardPanelOpen: false,
  abortController: null,
  lastUserMessage: null,
  lastAssistantEl: null,
  mode: 'board',
};

const ROLE_NAMES = {
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

const $ = (sel) => document.querySelector(sel);
const messagesEl = $('#messages');
const chatInput = $('#chatInput');
const sendBtn = $('#sendBtn');
const welcomeScreen = $('#welcomeScreen');
const greetingEl = $('#greeting');
const statusDot = $('.status-dot');
const statusText = $('.status-text');
const boardBtn = $('#boardBtn');
const boardPanel = $('#boardPanel');
const panelClose = $('#panelClose');
const boardMembersEl = $('#boardMembers');
const inputRole = $('#inputRole');
const roleSelector = $('#roleSelector');
const metaModel = $('#metaModel');
const liveRegion = () => document.getElementById('ariaLive');

function providerHeaders() {
  return window.__boardroomSettings?.getProviderKeysHeader?.() || {};
}

function getSettings() {
  return (
    window.__boardroomSettings?.getSettings?.() || {
      roleModels: {},
      globalProvider: 'nvidia',
      globalModel: '',
    }
  );
}

async function api(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...providerHeaders() },
  });
}

function announce(msg) {
  const el = liveRegion();
  if (el) el.textContent = msg;
}

function init() {
  setGreeting();
  setupEventListeners();
  initMobileChrome();
  initModalChrome();
  initWaveform();
  checkSystemStatus();
  loadBoardMembers();
  loadAnalytics();
  setInterval(loadAnalytics, 15000);
  window.addEventListener('boardroom:settings', () => {
    checkSystemStatus();
    loadBoardMembers();
  });
  window.addEventListener('resize', () => {
    document.documentElement.style.setProperty('--app-vh', `${window.innerHeight * 0.01}px`);
  });
  document.documentElement.style.setProperty('--app-vh', `${window.innerHeight * 0.01}px`);

  // visualViewport pin for mobile keyboard
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const onVV = () => {
      document.documentElement.style.setProperty('--vv-offset', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
    };
    vv.addEventListener('resize', onVV);
    vv.addEventListener('scroll', onVV);
  }
}

function setGreeting() {
  if (!greetingEl) return;
  const hour = new Date().getHours();
  if (hour < 12) greetingEl.textContent = 'morning';
  else if (hour < 17) greetingEl.textContent = 'afternoon';
  else greetingEl.textContent = 'evening';
}

function setupEventListeners() {
  sendBtn?.addEventListener('click', () => {
    if (state.isLoading) stopGeneration();
    else sendMessage();
  });

  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!state.isLoading) sendMessage();
    }
    if (e.key === 'Escape' && state.isLoading) stopGeneration();
  });

  chatInput?.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
    updateSendButton();
    setComposerActive(!!chatInput.value.trim() || state.isLoading);
  });

  chatInput?.addEventListener('focus', () => setComposerActive(true));
  chatInput?.addEventListener('blur', () => {
    if (!chatInput.value.trim() && !state.isLoading) setComposerActive(false);
  });

  document.querySelectorAll('.quick-action').forEach((btn) => {
    btn.addEventListener('click', () => {
      chatInput.value = btn.dataset.prompt;
      chatInput.dispatchEvent(new Event('input'));
      sendMessage();
    });
  });

  boardBtn?.addEventListener('click', () => {
    state.boardPanelOpen = !state.boardPanelOpen;
    boardPanel?.classList.toggle('open', state.boardPanelOpen);
    boardBtn.setAttribute('aria-expanded', state.boardPanelOpen ? 'true' : 'false');
  });
  panelClose?.addEventListener('click', () => {
    state.boardPanelOpen = false;
    boardPanel?.classList.remove('open');
    boardBtn?.setAttribute('aria-expanded', 'false');
  });

  inputRole?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleRoleSelector();
  });
  inputRole?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleRoleSelector();
    }
  });

  document.querySelectorAll('.role-option').forEach((opt) => {
    if (!opt.hasAttribute('role')) opt.setAttribute('role', 'option');
    if (!opt.hasAttribute('tabindex')) opt.setAttribute('tabindex', '0');
    opt.addEventListener('click', () => {
      setActiveRole(opt.dataset.role);
      if (roleSelector) roleSelector.hidden = true;
      inputRole?.setAttribute('aria-expanded', 'false');
    });
    opt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        opt.click();
      }
    });
  });

  document.addEventListener('click', () => {
    if (roleSelector) roleSelector.hidden = true;
    inputRole?.setAttribute('aria-expanded', 'false');
  });

  document.getElementById('modelChip')?.addEventListener('click', () => {
    document.getElementById('settingsBtn')?.click();
  });

  messagesEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-msg-action]');
    if (!btn) return;
    const action = btn.dataset.msgAction;
    const msg = btn.closest('.message');
    if (action === 'copy') {
      const raw = msg?.dataset?.raw || msg?.querySelector('.msg-content')?.innerText || '';
      navigator.clipboard?.writeText(raw).then(() => {
        btn.textContent = 'Copied';
        setTimeout(() => (btn.textContent = 'Copy'), 1200);
      });
    } else if (action === 'regenerate') {
      if (state.lastUserMessage && !state.isLoading) {
        sendMessage(state.lastUserMessage, { regenerate: true });
      }
    } else if (action === 'copy-code') {
      const pre = btn.closest('pre');
      const code = pre?.querySelector('code')?.innerText || '';
      navigator.clipboard?.writeText(code);
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = 'Copy'), 1200);
    }
  });

  document.getElementById('modeBoard')?.addEventListener('click', () => setMode('board'));
  document.getElementById('modeDirect')?.addEventListener('click', () => setMode('direct'));
}

function toggleRoleSelector() {
  if (!roleSelector) return;
  const rect = inputRole.getBoundingClientRect();
  const narrow = window.matchMedia('(max-width: 900px)').matches;
  if (narrow) {
    roleSelector.style.left = '10px';
    roleSelector.style.right = '10px';
    roleSelector.style.width = 'auto';
  } else {
    roleSelector.style.left = rect.left + 'px';
    roleSelector.style.right = 'auto';
    roleSelector.style.width = '';
  }
  roleSelector.style.bottom = Math.max(12, window.innerHeight - rect.top + 8) + 'px';
  const open = roleSelector.hidden;
  roleSelector.hidden = !open;
  inputRole?.setAttribute('aria-expanded', open ? 'true' : 'false');
  roleSelector?.setAttribute('role', 'listbox');
}

function updateSendButton() {
  if (!sendBtn) return;
  if (state.isLoading) {
    sendBtn.disabled = false;
    sendBtn.classList.add('is-stop');
    sendBtn.setAttribute('aria-label', 'Stop generating');
    sendBtn.title = 'Stop';
    sendBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
  } else {
    sendBtn.classList.remove('is-stop');
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.title = 'Send';
    sendBtn.disabled = !chatInput?.value?.trim();
    sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;
  }
}

function setMode(mode) {
  state.mode = mode === 'direct' ? 'direct' : 'board';
  const board = document.getElementById('modeBoard');
  const direct = document.getElementById('modeDirect');
  board?.classList.toggle('is-on', state.mode === 'board');
  direct?.classList.toggle('is-on', state.mode === 'direct');
  board?.setAttribute('aria-pressed', state.mode === 'board' ? 'true' : 'false');
  direct?.setAttribute('aria-pressed', state.mode === 'direct' ? 'true' : 'false');
  const ta = document.getElementById('chatInput');
  if (ta) {
    ta.placeholder = state.mode === 'board' ? 'Directive for the Board…' : 'Message this seat…';
  }
}

function setComposerActive(on) {
  document.getElementById('composerShell')?.classList.toggle('is-active', on);
  document.getElementById('composerShell')?.classList.toggle('is-thinking', state.isLoading);
}

function setActiveRole(role) {
  state.activeRole = role;
  const dot = inputRole?.querySelector('.role-dot');
  const name = inputRole?.querySelector('.role-name');
  if (dot) dot.dataset.role = role;
  if (name) name.textContent = ROLE_NAMES[role] || role;
  const member = state.boardMembers.find((m) => m.role === role);
  if (member && metaModel) {
    metaModel.textContent = `${member.provider || ''} · ${member.model || ''}`.replace(/^ · /, '');
  }
  updateModelChip();
  if (role !== 'jarvis') setMode('direct');
  else setMode('board');
}

async function checkSystemStatus() {
  try {
    const res = await api('/api/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    statusDot?.classList.add('online');
    statusDot?.classList.remove('offline');
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    if (data.demoMode) statusText.textContent = narrow ? 'Demo' : 'Demo · add keys';
    else if (data.nvidiaConfigured) statusText.textContent = narrow ? 'NIM' : 'NVIDIA Online';
    else if (data.apiKeyConfigured) statusText.textContent = 'Online';
    else statusText.textContent = 'Online';
  } catch {
    statusDot?.classList.add('offline');
    statusDot?.classList.remove('online');
    if (statusText) statusText.textContent = 'Offline';
  }
}

async function loadBoardMembers() {
  try {
    const settings = getSettings();
    const q = encodeURIComponent(JSON.stringify(settings.roleModels || {}));
    const res = await api(`/api/board?roleModels=${q}`);
    if (!res.ok) throw new Error('board fetch failed');
    const data = await res.json();
    state.boardMembers = data.members || [];
    renderBoardMembers();
    const jarvis = state.boardMembers.find((m) => m.role === 'jarvis');
    if (jarvis && metaModel) metaModel.textContent = `${jarvis.provider} · ${jarvis.model}`;
    updateModelChip();
  } catch {
    /* offline */
  }
}

function updateModelChip() {
  const chip = document.getElementById('modelChipLabel');
  if (!chip) return;
  const settings = getSettings();
  const pref = settings.roleModels?.[state.activeRole];
  if (pref?.model) {
    chip.textContent = pref.model.split('/').pop();
    return;
  }
  if (settings.globalModel) {
    chip.textContent = settings.globalModel.split('/').pop();
    return;
  }
  const member = state.boardMembers.find((m) => m.role === state.activeRole);
  chip.textContent = (member?.model || 'Auto NIM').split('/').pop();
}

async function loadAnalytics() {
  try {
    const res = await api('/api/vault/analytics');
    if (!res.ok) return;
    const { metrics, agentActivity } = await res.json();
    const analyticsEl = document.getElementById('analyticsMetrics');
    if (!analyticsEl) return;
    const activity = agentActivity || {};
    analyticsEl.innerHTML = `
      <div class="analytics-block">
        <div class="analytics-row"><span>Boot cycles</span><strong>${metrics?.serverStarts ?? 0}</strong></div>
        <div class="analytics-row"><span>Queries</span><strong>${metrics?.chatQueries ?? 0}</strong></div>
        <div class="analytics-row"><span>Vault events</span><strong>${metrics?.totalEvents ?? 0}</strong></div>
        <div class="analytics-top">
          ${
            Object.keys(activity).length
              ? Object.entries(activity)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(
                    ([a, c]) =>
                      `<div class="analytics-row"><span>${escapeHtml(a)}</span><strong class="accent">${c}</strong></div>`
                  )
                  .join('')
              : '<div class="analytics-empty">No events yet</div>'
          }
        </div>
      </div>`;
  } catch {
    /* silent */
  }
}

function renderBoardMembers() {
  if (!boardMembersEl) return;
  boardMembersEl.innerHTML = state.boardMembers
    .map(
      (member) => `
    <button type="button" class="member-card" data-role="${member.role}">
      <div class="member-card-avatar">
        <img src="/images/${member.role}.png" alt="${escapeHtml(ROLE_NAMES[member.role] || member.role)}" onerror="this.src='/images/jarvis.png'" />
      </div>
      <div class="member-card-content">
        <h3>${ROLE_NAMES[member.role] || member.role}</h3>
        <p>${escapeHtml(member.description || '')}</p>
        <div class="member-meta">
          <span class="model-tag">${escapeHtml((member.provider || '') + ' · ' + (member.model || ''))}</span>
        </div>
      </div>
    </button>`
    )
    .join('');

  boardMembersEl.querySelectorAll('.member-card').forEach((card) => {
    card.addEventListener('click', () => {
      setActiveRole(card.dataset.role);
      state.boardPanelOpen = false;
      boardPanel?.classList.remove('open');
    });
  });
}

function stopGeneration() {
  try {
    state.abortController?.abort();
  } catch {
    /* ignore */
  }
  state.abortController = null;
  state.isLoading = false;
  setComposerActive(!!chatInput?.value?.trim());
  updateSendButton();
  announce('Generation stopped');
}

async function sendMessage(forcedText, opts = {}) {
  const text = (forcedText ?? chatInput?.value?.trim()) || '';
  if (!text || state.isLoading) return;
  if (welcomeScreen) welcomeScreen.style.display = 'none';

  state.lastUserMessage = text;
  if (!opts.regenerate) {
    appendMessage('user', text);
    if (chatInput) {
      chatInput.value = '';
      chatInput.style.height = 'auto';
    }
  } else {
    messagesEl?.querySelector('.session-card:last-of-type')?.remove();
    const last = messagesEl?.querySelector('.message--assistant:last-of-type');
    last?.remove();
  }

  state.isLoading = true;
  setComposerActive(true);
  updateSendButton();
  state.abortController = new AbortController();

  if (state.mode === 'board' && window.__boardSession?.runBoardSession) {
    announce('Convening the board');
    try {
      await window.__boardSession.runBoardSession({
        message: text,
        api,
        signal: state.abortController.signal,
        onStatus: announce,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        appendMessage('assistant', `Board session error: ${err.message}`, { role: 'jarvis', model: 'error' });
      }
    } finally {
      state.isLoading = false;
      state.abortController = null;
      setComposerActive(!!chatInput?.value?.trim());
      updateSendButton();
      announce('Session closed');
    }
    return;
  }

  announce('Generating response');
  const streamEl = beginAssistantStream();

  try {
    const settings = getSettings();
    const body = {
      message: text,
      sessionId: state.sessionId,
      role: state.activeRole,
      roleModels: settings.roleModels || {},
    };
    if (settings.globalModel && settings.globalProvider) {
      body.provider = settings.globalProvider;
      body.model = settings.globalModel;
    }

    const res = await api('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: state.abortController.signal,
    });

    if (!res.ok) {
      // fallback non-stream
      const fallback = await api('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await fallback.json();
      finalizeAssistantStream(streamEl, data.response || data.error || 'No response', {
        role: data.role || state.activeRole,
        model: data.model,
        provider: data.provider,
        boardMember: data.boardMember,
      });
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No stream reader');
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let meta = { role: state.activeRole };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === 'meta') {
          meta = { ...meta, ...ev };
          updateStreamHeader(streamEl, meta);
        } else if (ev.type === 'delta' && ev.delta) {
          full += ev.delta;
          updateStreamContent(streamEl, full);
        } else if (ev.type === 'done') {
          full = ev.content || full;
          meta = { ...meta, ...ev };
        } else if (ev.type === 'error' && !full) {
          full = ev.error || 'Error';
        }
      }
    }

    finalizeAssistantStream(streamEl, full || 'No response.', meta);
    if (metaModel && meta.model) {
      metaModel.textContent = `${meta.provider || ''} · ${meta.model}`.replace(/^ · /, '');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      const partial = streamEl?.dataset?.raw || '';
      finalizeAssistantStream(streamEl, partial ? partial + '\n\n*(stopped)*' : '*(stopped)*', {
        role: state.activeRole,
        model: 'stopped',
      });
    } else {
      finalizeAssistantStream(streamEl, `Connection error: ${err.message}`, {
        role: 'jarvis',
        model: 'error',
      });
    }
  } finally {
    state.isLoading = false;
    state.abortController = null;
    setComposerActive(!!chatInput?.value?.trim());
    updateSendButton();
    announce('Response ready');
  }
}

function beginAssistantStream() {
  if (!messagesEl) return null;
  const role = state.activeRole;
  const msgEl = document.createElement('div');
  msgEl.className = 'message message--assistant is-streaming';
  msgEl.innerHTML = `
    <div class="msg-avatar msg-avatar--${role}">
      <img src="/images/${role}.png" alt="${escapeHtml(ROLE_NAMES[role] || role)}" onerror="this.src='/images/jarvis.png'" />
    </div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-name">${ROLE_NAMES[role] || role}</span>
        <span class="msg-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="msg-model msg-model--live">streaming…</span>
      </div>
      <div class="msg-content"><span class="stream-cursor"></span></div>
      <div class="msg-actions" hidden></div>
    </div>`;
  messagesEl.appendChild(msgEl);
  state.lastAssistantEl = msgEl;
  scrollToBottom();
  return msgEl;
}

function updateStreamHeader(msgEl, meta) {
  if (!msgEl) return;
  const name = msgEl.querySelector('.msg-name');
  const model = msgEl.querySelector('.msg-model');
  const role = meta.role || state.activeRole;
  if (name) name.textContent = ROLE_NAMES[role] || role;
  if (model) {
    model.textContent = meta.model
      ? `${meta.provider ? meta.provider + ' · ' : ''}${meta.model}`
      : 'streaming…';
  }
  const img = msgEl.querySelector('.msg-avatar img');
  if (img) img.src = `/images/${role}.png`;
}

function updateStreamContent(msgEl, text) {
  if (!msgEl) return;
  msgEl.dataset.raw = text;
  const content = msgEl.querySelector('.msg-content');
  if (content) content.innerHTML = renderMarkdown(text) + '<span class="stream-cursor"></span>';
  scrollToBottom();
}

function finalizeAssistantStream(msgEl, text, meta = {}) {
  if (!msgEl) {
    appendMessage('assistant', text, meta);
    return;
  }
  msgEl.classList.remove('is-streaming');
  msgEl.dataset.raw = text;
  updateStreamHeader(msgEl, meta);
  const content = msgEl.querySelector('.msg-content');
  if (content) content.innerHTML = renderMarkdown(text);
  enhanceCodeBlocks(msgEl);
  const actions = msgEl.querySelector('.msg-actions');
  if (actions) {
    actions.hidden = false;
    actions.innerHTML = `
      <button type="button" class="msg-action-btn" data-msg-action="copy">Copy</button>
      <button type="button" class="msg-action-btn" data-msg-action="regenerate">Regenerate</button>
    `;
  }
  scrollToBottom();
}

function enhanceCodeBlocks(root) {
  root?.querySelectorAll('pre')?.forEach((pre) => {
    if (pre.querySelector('.code-copy')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy msg-action-btn';
    btn.dataset.msgAction = 'copy-code';
    btn.textContent = 'Copy';
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}

function appendMessage(type, content, meta = {}) {
  if (!messagesEl) return;
  const msgEl = document.createElement('div');
  msgEl.className = `message message--${type}`;
  msgEl.dataset.raw = content;
  const role = meta.role || state.activeRole;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (type === 'user') {
    msgEl.innerHTML = `
      <div class="msg-avatar msg-avatar--user">YOU</div>
      <div class="msg-body">
        <div class="msg-header"><span class="msg-name">You</span><span class="msg-time">${time}</span></div>
        <div class="msg-content">${escapeHtml(content)}</div>
      </div>`;
  } else {
    msgEl.innerHTML = `
      <div class="msg-avatar msg-avatar--${role}">
        <img src="/images/${role}.png" alt="${escapeHtml(ROLE_NAMES[role] || role)}" onerror="this.src='/images/jarvis.png'" />
      </div>
      <div class="msg-body">
        <div class="msg-header">
          <span class="msg-name">${ROLE_NAMES[role] || role}</span>
          <span class="msg-time">${time}</span>
          ${meta.model ? `<span class="msg-model">${escapeHtml((meta.provider ? meta.provider + ' · ' : '') + meta.model)}</span>` : ''}
        </div>
        <div class="msg-content">${renderMarkdown(content)}</div>
        <div class="msg-actions">
          <button type="button" class="msg-action-btn" data-msg-action="copy">Copy</button>
          <button type="button" class="msg-action-btn" data-msg-action="regenerate">Regenerate</button>
        </div>
      </div>`;
    enhanceCodeBlocks(msgEl);
  }
  messagesEl.appendChild(msgEl);
  scrollToBottom();
  return msgEl;
}

function showTyping() {
  return beginAssistantStream();
}

function removeTyping(el) {
  if (el?.parentNode && el.classList.contains('is-streaming') && !el.dataset.raw) {
    el.parentNode.removeChild(el);
  }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function safeHref(url) {
  try {
    const u = new URL(url, window.location.origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch {
    /* ignore */
  }
  return '#';
}

function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    return `<a href="${escapeHtml(safeHref(href))}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>\s*(<(h[1-3]|pre|ul)>)/g, '$1');
  html = html.replace(/(<\/(h[1-3]|pre|ul)>)\s*<\/p>/g, '$1');
  return html;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

function initModalChrome() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const settings = document.getElementById('settingsModal');
    if (settings && !settings.hidden) {
      settings.hidden = true;
      return;
    }
    ['mindMapModal', 'canvasModal', 'notepadModal', 'attachSheet'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && !el.hidden) el.hidden = true;
    });
    if (state.boardPanelOpen) {
      state.boardPanelOpen = false;
      boardPanel?.classList.remove('open');
    }
    if (roleSelector) roleSelector.hidden = true;
  });

  // Mark settings as dialog
  const settings = document.getElementById('settingsModal');
  if (settings) {
    settings.setAttribute('role', 'dialog');
    settings.setAttribute('aria-modal', 'true');
    settings.setAttribute('aria-label', 'Boardroom settings');
  }
}

function initMobileChrome() {
  const moreBtn = document.getElementById('headerMoreBtn');
  const moreMenu = document.getElementById('headerMoreMenu');
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = moreMenu.hasAttribute('hidden');
      if (open) moreMenu.removeAttribute('hidden');
      else moreMenu.setAttribute('hidden', '');
      moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    moreMenu.querySelectorAll('[data-trigger]').forEach((item) => {
      item.addEventListener('click', () => {
        document.getElementById(item.getAttribute('data-trigger'))?.click();
        moreMenu.setAttribute('hidden', '');
        moreBtn.setAttribute('aria-expanded', 'false');
      });
    });
    document.addEventListener('click', () => {
      moreMenu.setAttribute('hidden', '');
      moreBtn.setAttribute('aria-expanded', 'false');
    });
    moreMenu.addEventListener('click', (e) => e.stopPropagation());
  }

  document.getElementById('chatInput')?.addEventListener('focus', () => {
    setTimeout(() => {
      document.getElementById('composerShell')?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }, 280);
  });

  document.getElementById('main')?.addEventListener('click', (e) => {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    if (!state.boardPanelOpen) return;
    if (e.target.closest?.('#boardPanel, #boardBtn')) return;
    state.boardPanelOpen = false;
    boardPanel?.classList.remove('open');
  });
}

function initWaveform() {
  const canvas = document.getElementById('composerWave');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let t = 0;
  let running = true;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const h = window.matchMedia('(max-width: 900px)').matches ? 22 : 36;
    canvas.width = Math.max(120, rect.width) * dpr;
    canvas.height = h * dpr;
    canvas.style.width = '100%';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const preferReduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function draw() {
    if (!running) return;
    const shell = document.getElementById('composerShell');
    const active = shell?.classList.contains('is-active') || shell?.classList.contains('is-thinking');
    const thinking = shell?.classList.contains('is-thinking');
    // Idle: slow tick every ~500ms instead of 60fps
    if (!active && !thinking) {
      t += 0.2;
    } else {
      t += 1;
    }

    const w = canvas.clientWidth || 300;
    const h = window.matchMedia('(max-width: 900px)').matches ? 22 : 36;
    ctx.clearRect(0, 0, w, h);
    const bars = 48;
    const gap = 2;
    const barW = (w - gap * bars) / bars;
    for (let i = 0; i < bars; i++) {
      const phase = t * (thinking ? 0.18 : 0.08) + i * 0.35;
      const envelope = active
        ? 0.55 + 0.45 * Math.sin(phase) * Math.sin(phase * 0.4 + t * 0.05)
        : 0.12 + 0.06 * Math.sin(i + t * 0.02);
      const bh = Math.max(2, envelope * (h - 8));
      const x = i * (barW + gap);
      const y = (h - bh) / 2;
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, thinking ? '#22d3ee' : '#60a5fa');
      grad.addColorStop(1, thinking ? '#a78bfa' : '#06b6d4');
      ctx.fillStyle = grad;
      ctx.globalAlpha = active ? 0.85 : 0.28;
      ctx.beginPath();
      const r = Math.min(2, barW / 2);
      if (ctx.roundRect) ctx.roundRect(x, y, barW, bh, r);
      else ctx.rect(x, y, barW, bh);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (preferReduce.matches && !thinking) {
      setTimeout(() => {
        raf = requestAnimationFrame(draw);
      }, 400);
    } else if (!active && !thinking) {
      setTimeout(() => {
        raf = requestAnimationFrame(draw);
      }, 120);
    } else {
      raf = requestAnimationFrame(draw);
    }
  }
  draw();
}

document.addEventListener('DOMContentLoaded', init);

window.__boardroom = {
  state,
  appendMessage,
  showTyping,
  removeTyping,
  scrollToBottom,
  reloadStatus: checkSystemStatus,
  loadBoardMembers,
  stopGeneration,
  api,
};
