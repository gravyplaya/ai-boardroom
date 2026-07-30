/**
 * app.js — AI Boardroom Frontend (multi-provider + waveform input)
 */

const state = {
  activeRole: 'jarvis',
  sessionId: crypto.randomUUID(),
  isLoading: false,
  boardMembers: [],
  boardPanelOpen: false,
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

function providerHeaders() {
  return window.__boardroomSettings?.getProviderKeysHeader?.() || {};
}

function getSettings() {
  return window.__boardroomSettings?.getSettings?.() || { roleModels: {}, globalProvider: 'nvidia', globalModel: '' };
}

async function api(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...providerHeaders(),
  };
  return fetch(url, { ...options, headers });
}

function init() {
  setGreeting();
  setupEventListeners();
  initMobileChrome();
  initWaveform();
  checkSystemStatus();
  loadBoardMembers();
  loadAnalytics();
  setInterval(loadAnalytics, 10000);
  window.addEventListener('boardroom:settings', () => {
    checkSystemStatus();
    loadBoardMembers();
  });
  window.addEventListener('resize', () => {
    document.documentElement.style.setProperty('--app-vh', `${window.innerHeight * 0.01}px`);
  });
  document.documentElement.style.setProperty('--app-vh', `${window.innerHeight * 0.01}px`);
}

function setGreeting() {
  if (!greetingEl) return;
  const hour = new Date().getHours();
  if (hour < 12) greetingEl.textContent = 'morning';
  else if (hour < 17) greetingEl.textContent = 'afternoon';
  else greetingEl.textContent = 'evening';
}

function setupEventListeners() {
  sendBtn?.addEventListener('click', sendMessage);
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  chatInput?.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
    if (sendBtn) sendBtn.disabled = !chatInput.value.trim();
    setComposerActive(!!chatInput.value.trim());
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
  });
  panelClose?.addEventListener('click', () => {
    state.boardPanelOpen = false;
    boardPanel?.classList.remove('open');
  });

  inputRole?.addEventListener('click', (e) => {
    e.stopPropagation();
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
    roleSelector.hidden = !roleSelector.hidden;
  });

  document.querySelectorAll('.role-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      setActiveRole(opt.dataset.role);
      if (roleSelector) roleSelector.hidden = true;
    });
  });

  document.addEventListener('click', () => {
    if (roleSelector) roleSelector.hidden = true;
  });

  // Model chip opens settings
  document.getElementById('modelChip')?.addEventListener('click', () => {
    document.getElementById('settingsBtn')?.click();
  });
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
  if (member && metaModel) metaModel.textContent = `${member.provider || ''} · ${member.model || ''}`.replace(/^ · /, '');
  updateModelChip();
}

async function checkSystemStatus() {
  try {
    const res = await api('/api/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    statusDot?.classList.add('online');
    statusDot?.classList.remove('offline');
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    if (data.demoMode) statusText.textContent = narrow ? 'Demo' : 'Demo · add NVIDIA key';
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
                  .map(([a, c]) => `<div class="analytics-row"><span>${escapeHtml(a)}</span><strong class="accent">${c}</strong></div>`)
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
    <div class="member-card" data-role="${member.role}">
      <div class="member-card-avatar">
        <img src="/images/${member.role}.png" alt="${member.role}" onerror="this.src='/images/jarvis.png'" />
      </div>
      <div class="member-card-content">
        <h3>${ROLE_NAMES[member.role] || member.role}</h3>
        <p>${escapeHtml(member.description || '')}</p>
        <div class="member-meta">
          <span class="model-tag">${escapeHtml((member.provider || '') + ' · ' + (member.model || ''))}</span>
        </div>
      </div>
    </div>`
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

async function sendMessage() {
  const text = chatInput?.value?.trim();
  if (!text || state.isLoading) return;
  if (welcomeScreen) welcomeScreen.style.display = 'none';

  appendMessage('user', text);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  if (sendBtn) sendBtn.disabled = true;

  const typingEl = showTyping();
  state.isLoading = true;
  setComposerActive(true);

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

    const res = await api('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let data;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json();
    else throw new Error('Server returned non-JSON (API may not be deployed).');

    removeTyping(typingEl);
    if (data.error && !data.response) {
      appendMessage('assistant', `⚠️ ${data.error}`, { role: 'jarvis', model: 'error' });
      return;
    }
    appendMessage('assistant', data.response || 'No response.', {
      role: data.role || state.activeRole,
      model: data.model,
      provider: data.provider,
      boardMember: data.boardMember,
    });
    if (metaModel && data.model) metaModel.textContent = `${data.provider || ''} · ${data.model}`.replace(/^ · /, '');
  } catch (err) {
    removeTyping(typingEl);
    appendMessage('assistant', `⚠️ Connection error: ${err.message}`, { role: 'jarvis', model: 'error' });
  } finally {
    state.isLoading = false;
    setComposerActive(!!chatInput?.value?.trim());
  }
}

function appendMessage(type, content, meta = {}) {
  if (!messagesEl) return;
  const msgEl = document.createElement('div');
  msgEl.className = `message message--${type}`;
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
        <img src="/images/${role}.png" alt="${ROLE_NAMES[role] || role}" onerror="this.src='/images/jarvis.png'" />
      </div>
      <div class="msg-body">
        <div class="msg-header">
          <span class="msg-name">${ROLE_NAMES[role] || role}</span>
          <span class="msg-time">${time}</span>
          ${meta.model ? `<span class="msg-model">${escapeHtml((meta.provider ? meta.provider + ' · ' : '') + meta.model)}</span>` : ''}
        </div>
        <div class="msg-content">${renderMarkdown(content)}</div>
      </div>`;
  }
  messagesEl.appendChild(msgEl);
  scrollToBottom();
}

function showTyping() {
  if (!messagesEl) return null;
  const role = state.activeRole;
  const el = document.createElement('div');
  el.className = 'message message--assistant';
  el.id = 'typing-indicator';
  el.innerHTML = `
    <div class="msg-avatar msg-avatar--${role}">
      <img src="/images/${role}.png" alt="" onerror="this.src='/images/jarvis.png'" />
    </div>
    <div class="msg-body">
      <div class="msg-header"><span class="msg-name">${ROLE_NAMES[role]} is thinking…</span></div>
      <div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
    </div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function removeTyping(el) {
  if (el?.parentNode) el.parentNode.removeChild(el);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
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
  const map = { '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' };
  return String(text).replace(/[&<>"']/g, (c) => map[c]);
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
        const id = item.getAttribute('data-trigger');
        document.getElementById(id)?.click();
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

  // iOS keyboard: scroll focused input into view
  document.getElementById('chatInput')?.addEventListener('focus', () => {
    setTimeout(() => {
      document.getElementById('composerShell')?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }, 300);
  });

  // Close board panel when tapping backdrop on mobile
  document.getElementById('main')?.addEventListener('click', (e) => {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    if (!state.boardPanelOpen) return;
    if (e.target.closest?.('#boardPanel, #boardBtn')) return;
    state.boardPanelOpen = false;
    boardPanel?.classList.remove('open');
  });
}

// ── Waveform canvas in composer ─────────────────────────────────────────────
function initWaveform() {
  const canvas = document.getElementById('composerWave');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let t = 0;

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

  function draw() {
    const w = canvas.clientWidth || 300;
    const h = window.matchMedia('(max-width: 900px)').matches ? 22 : 36;
    ctx.clearRect(0, 0, w, h);
    const shell = document.getElementById('composerShell');
    const active = shell?.classList.contains('is-active') || shell?.classList.contains('is-thinking');
    const thinking = shell?.classList.contains('is-thinking');
    const bars = 48;
    const gap = 2;
    const barW = (w - gap * bars) / bars;
    for (let i = 0; i < bars; i++) {
      const phase = t * (thinking ? 0.18 : 0.08) + i * 0.35;
      const envelope = active ? 0.55 + 0.45 * Math.sin(phase) * Math.sin(phase * 0.4 + t * 0.05) : 0.15 + 0.08 * Math.sin(i + t * 0.02);
      const bh = Math.max(2, envelope * (h - 8));
      const x = i * (barW + gap);
      const y = (h - bh) / 2;
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, thinking ? '#22d3ee' : '#60a5fa');
      grad.addColorStop(1, thinking ? '#a78bfa' : '#06b6d4');
      ctx.fillStyle = grad;
      ctx.globalAlpha = active ? 0.85 : 0.35;
      ctx.beginPath();
      const r = Math.min(2, barW / 2);
      ctx.roundRect?.(x, y, barW, bh, r) || ctx.rect(x, y, barW, bh);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    t += 1;
    raf = requestAnimationFrame(draw);
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
  api,
};
