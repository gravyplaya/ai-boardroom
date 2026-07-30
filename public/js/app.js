/**
 * app.js — AI Boardroom Frontend Application
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

function init() {
  setGreeting();
  setupEventListeners();
  checkSystemStatus();
  loadBoardMembers();
  loadAnalytics();
  setInterval(loadAnalytics, 8000);
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
    roleSelector.style.left = rect.left + 'px';
    roleSelector.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
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
}

function setActiveRole(role) {
  state.activeRole = role;
  const dot = inputRole?.querySelector('.role-dot');
  const name = inputRole?.querySelector('.role-name');
  if (dot) dot.dataset.role = role;
  if (name) name.textContent = ROLE_NAMES[role] || role;

  const member = state.boardMembers.find((m) => m.role === role);
  if (member && metaModel) metaModel.textContent = member.model;
}

async function checkSystemStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    statusDot?.classList.add('online');
    statusDot?.classList.remove('offline');
    if (data.demoMode) {
      statusText.textContent = 'Demo Mode';
    } else if (data.apiKeyConfigured) {
      statusText.textContent = 'Online';
    } else {
      statusText.textContent = 'Online';
    }
  } catch {
    statusDot?.classList.add('offline');
    statusDot?.classList.remove('online');
    if (statusText) statusText.textContent = 'Offline';
  }
}

async function loadBoardMembers() {
  try {
    const res = await fetch('/api/board');
    if (!res.ok) throw new Error('board fetch failed');
    const data = await res.json();
    state.boardMembers = data.members || [];
    renderBoardMembers();

    const jarvis = state.boardMembers.find((m) => m.role === 'jarvis');
    if (jarvis && metaModel) metaModel.textContent = jarvis.model;
  } catch {
    // offline — UI still usable for static welcome
  }
}

async function loadAnalytics() {
  try {
    const res = await fetch('/api/vault/analytics');
    if (!res.ok) return;
    const { metrics, agentActivity } = await res.json();
    const analyticsEl = document.getElementById('analyticsMetrics');
    if (!analyticsEl) return;

    const activity = agentActivity || {};
    analyticsEl.innerHTML = `
      <div style="font-size:0.8rem; color:var(--text-secondary); line-height: 1.6;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span>System Boot Cycles:</span>
          <strong style="color:var(--text-primary)">${metrics?.serverStarts ?? 0}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span>Queries Processed:</span>
          <strong style="color:var(--text-primary)">${metrics?.chatQueries ?? 0}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
          <span>Total Vault Events:</span>
          <strong style="color:var(--text-primary)">${metrics?.totalEvents ?? 0}</strong>
        </div>
        <div style="border-top:1px solid rgba(255,255,255,0.05); padding-top:12px;">
          <div style="margin-bottom:6px; color:var(--text-tertiary); font-size:0.7rem; text-transform:uppercase;">Top Agent Activity</div>
          ${
            Object.keys(activity).length
              ? Object.entries(activity)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(
                    ([agent, count]) => `
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span>${escapeHtml(agent)}</span>
                <strong style="color:var(--accent-cyan)">${count}</strong>
              </div>`
                  )
                  .join('')
              : '<div style="opacity:0.6">No events yet</div>'
          }
        </div>
      </div>
    `;
  } catch {
    // silent
  }
}

function renderBoardMembers() {
  if (!boardMembersEl) return;
  boardMembersEl.innerHTML = state.boardMembers
    .map(
      (member) => `
    <div class="member-card" data-role="${member.role}">
      <div class="member-card-avatar">
        <img src="/images/${member.role}.png" alt="Avatar for ${member.role}" onerror="this.src='/images/jarvis.png'" />
      </div>
      <div class="member-card-content">
        <h3>${ROLE_NAMES[member.role] || member.role}</h3>
        <p>${escapeHtml(member.description || '')}</p>
        <div class="member-meta">
          <span class="model-tag">${escapeHtml(member.model || '')}</span>
          <span class="status-indicator-mini"><span class="status-dot online"></span> Active</span>
        </div>
      </div>
    </div>
  `
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

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        sessionId: state.sessionId,
        role: state.activeRole,
      }),
    });

    let data;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await res.json();
    } else {
      const raw = await res.text();
      throw new Error(
        res.ok
          ? 'Server returned non-JSON (API may not be deployed).'
          : `HTTP ${res.status}: ${raw.slice(0, 120)}`
      );
    }

    removeTyping(typingEl);

    if (data.error && !data.response) {
      appendMessage('assistant', `⚠️ ${data.error}${data.details ? ': ' + data.details : ''}`, {
        role: 'jarvis',
        model: 'error',
      });
      return;
    }

    appendMessage('assistant', data.response || 'No response received.', {
      role: data.role || state.activeRole,
      model: data.model,
      boardMember: data.boardMember,
    });
  } catch (err) {
    removeTyping(typingEl);
    appendMessage(
      'assistant',
      `⚠️ Connection error: ${err.message}. If this is the live site, the API serverless function may not be running — redeploy with the fixed vercel.json.`,
      { role: 'jarvis', model: 'error' }
    );
  } finally {
    state.isLoading = false;
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
        <div class="msg-header">
          <span class="msg-name">You</span>
          <span class="msg-time">${time}</span>
        </div>
        <div class="msg-content">${escapeHtml(content)}</div>
      </div>
    `;
  } else {
    msgEl.innerHTML = `
      <div class="msg-avatar msg-avatar--${role}">
        <img src="/images/${role}.png" alt="${ROLE_NAMES[role] || role}" onerror="this.src='/images/jarvis.png'" />
      </div>
      <div class="msg-body">
        <div class="msg-header">
          <span class="msg-name">${ROLE_NAMES[role] || role}</span>
          <span class="msg-time">${time}</span>
          ${meta.model ? `<span class="msg-model">${escapeHtml(meta.model)}</span>` : ''}
        </div>
        <div class="msg-content">${renderMarkdown(content)}</div>
      </div>
    `;
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
      <img src="/images/${role}.png" alt="${ROLE_NAMES[role]}" onerror="this.src='/images/jarvis.png'" />
    </div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-name">${ROLE_NAMES[role]} is thinking...</span>
      </div>
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function removeTyping(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
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
  html = html.replace(/<p>\s*(<h[1-3]>)/g, '$1');
  html = html.replace(/(<\/h[1-3]>)\s*<\/p>/g, '$1');
  html = html.replace(/<p>\s*(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)\s*<\/p>/g, '$1');
  html = html.replace(/<p>\s*(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');
  return html;
}

function escapeHtml(text) {
  const map = { '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' };
  return String(text).replace(/[&<>"']/g, (c) => map[c]);
}

document.addEventListener('DOMContentLoaded', init);

window.__boardroom = { state, appendMessage, showTyping, removeTyping, scrollToBottom };
