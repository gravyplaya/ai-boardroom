/**
 * session.js — Board session theater (parallel seats + decision packet)
 */

const ROLE_NAMES = {
  jarvis: 'JARVIS',
  architect: 'Architect',
  coder: 'Coder',
  creative: 'Creative',
  analyst: 'Analyst',
  product: 'Product',
  devops: 'DevOps',
  security: 'Security',
  qa: 'QA',
};

const PHASE_LABEL = {
  brief: 'Brief',
  deliberate: 'Deliberation',
  challenge: 'Challenge',
  packet: 'Decision packet',
};

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

function mdLite(text) {
  let html = escapeHtml(text || '');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function createSessionCard() {
  const el = document.createElement('div');
  el.className = 'session-card is-live';
  el.innerHTML = `
    <div class="session-head">
      <div class="session-kicker">Board session</div>
      <div class="session-phase-label" data-phase>Convening…</div>
    </div>
    <div class="session-brief" hidden>
      <div class="session-col-head">
        <span class="role-dot" data-role="jarvis"></span>
        JARVIS brief
      </div>
      <div class="session-col-body" data-brief></div>
    </div>
    <div class="session-grid" data-grid></div>
    <div class="session-challenge" hidden>
      <div class="session-col-head" data-challenge-head>Challenge</div>
      <div class="session-col-body" data-challenge></div>
    </div>
    <div class="session-packet" hidden data-packet></div>
    <div class="session-foot" data-foot></div>
  `;
  return el;
}

function ensureColumn(grid, role) {
  let col = grid.querySelector(`[data-seat="${role}"]`);
  if (col) return col;
  col = document.createElement('article');
  col.className = 'session-col';
  col.dataset.seat = role;
  col.innerHTML = `
    <div class="session-col-head">
      <span class="role-dot" data-role="${role}"></span>
      <img src="/images/${role}.png" alt="" class="session-avatar" onerror="this.style.display='none'"/>
      ${escapeHtml(ROLE_NAMES[role] || role)}
      <span class="session-col-status">speaking</span>
    </div>
    <div class="session-col-body"></div>
  `;
  grid.appendChild(col);
  return col;
}

function renderPacket(packet, vaultPath) {
  if (!packet) return '';
  const actions = (packet.actions || [])
    .map(
      (a) =>
        `<li><span class="pkt-owner">${escapeHtml(a.owner)}</span> ${escapeHtml(a.action)}</li>`
    )
    .join('');
  const plan = (packet.plan || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('');
  const risks = (packet.risks || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('');
  const files = (packet.files || []).map((p) => `<code>${escapeHtml(p)}</code>`).join(' ');
  return `
    <div class="pkt-kicker">Decision packet</div>
    <h3 class="pkt-decision">${escapeHtml(packet.decision || packet.goal || '')}</h3>
    ${packet.goal && packet.goal !== packet.decision ? `<p class="pkt-goal">${escapeHtml(packet.goal)}</p>` : ''}
    ${plan ? `<div class="pkt-block"><h4>Plan</h4><ol>${plan}</ol></div>` : ''}
    ${risks ? `<div class="pkt-block"><h4>Risks</h4><ul>${risks}</ul></div>` : ''}
    ${actions ? `<div class="pkt-block"><h4>Owners</h4><ul>${actions}</ul></div>` : ''}
    ${packet.dissent ? `<div class="pkt-block pkt-dissent"><h4>Dissent</h4><p>${escapeHtml(packet.dissent)}</p></div>` : ''}
    ${files ? `<div class="pkt-block"><h4>Artifacts</h4><p>${files}</p></div>` : ''}
    ${vaultPath ? `<p class="pkt-vault">Minutes saved to <code>${escapeHtml(vaultPath)}</code></p>` : ''}
    <div class="pkt-actions">
      <button type="button" class="msg-action-btn" data-pkt="copy">Copy packet</button>
    </div>
  `;
}

async function runBoardSession({ message, api, signal, onStatus }) {
  const messagesEl = document.getElementById('messages');
  if (!messagesEl) throw new Error('messages missing');

  const card = createSessionCard();
  messagesEl.appendChild(card);
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  const briefEl = card.querySelector('[data-brief]');
  const briefWrap = card.querySelector('.session-brief');
  const grid = card.querySelector('[data-grid]');
  const challengeWrap = card.querySelector('.session-challenge');
  const challengeBody = card.querySelector('[data-challenge]');
  const challengeHead = card.querySelector('[data-challenge-head]');
  const packetEl = card.querySelector('[data-packet]');
  const phaseEl = card.querySelector('[data-phase]');
  const foot = card.querySelector('[data-foot]');

  const buffers = {};
  let vaultPath = '';
  let packet = null;

  const setPhase = (phase, extra) => {
    phaseEl.textContent = extra || PHASE_LABEL[phase] || phase;
    onStatus?.(phase);
  };

  const settings =
    window.__boardroomSettings?.getSettings?.() || { roleModels: {}, globalProvider: '', globalModel: '' };
  const body = {
    message,
    sessionId: window.__boardroom?.state?.sessionId,
    roleModels: settings.roleModels || {},
  };
  if (settings.globalModel && settings.globalProvider) {
    body.provider = settings.globalProvider;
    body.model = settings.globalModel;
  }

  const res = await api('/api/session/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Session failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  const handle = (ev) => {
    if (ev.type === 'session') {
      phaseEl.textContent = `Seats: ${(ev.seats || []).map((s) => ROLE_NAMES[s] || s).join(' · ')}`;
    } else if (ev.type === 'phase') {
      setPhase(ev.phase);
    } else if (ev.type === 'member_start') {
      buffers[ev.role] = buffers[ev.role] || '';
      if (ev.phase === 'brief') briefWrap.hidden = false;
      else if (ev.phase === 'deliberate') ensureColumn(grid, ev.role);
      else if (ev.phase === 'challenge') {
        challengeWrap.hidden = false;
        challengeHead.innerHTML = `<span class="role-dot" data-role="${ev.role}"></span> Challenge — ${escapeHtml(ROLE_NAMES[ev.role] || ev.role)}`;
      }
    } else if (ev.type === 'delta') {
      buffers[ev.role] = (buffers[ev.role] || '') + (ev.delta || '');
      if (ev.phase === 'brief') briefEl.innerHTML = mdLite(buffers[ev.role]);
      else if (ev.phase === 'challenge') challengeBody.innerHTML = mdLite(buffers[ev.role]);
      else if (ev.phase === 'deliberate') {
        const col = ensureColumn(grid, ev.role);
        col.querySelector('.session-col-body').innerHTML = mdLite(buffers[ev.role]);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else if (ev.type === 'member_done') {
      if (ev.phase === 'deliberate') {
        const col = ensureColumn(grid, ev.role);
        const st = col.querySelector('.session-col-status');
        if (st) st.textContent = 'done';
      }
    } else if (ev.type === 'packet') {
      packet = ev.packet;
      packetEl.hidden = false;
      packetEl.innerHTML = renderPacket(packet, vaultPath);
    } else if (ev.type === 'vault') {
      vaultPath = ev.path;
      if (packet) packetEl.innerHTML = renderPacket(packet, vaultPath);
    } else if (ev.type === 'done') {
      card.classList.remove('is-live');
      foot.innerHTML = ev.demo
        ? '<span class="session-note">Demo session — add a key in Settings for a live board.</span>'
        : vaultPath
          ? `<span class="session-note">Minutes in vault · ${escapeHtml(vaultPath)}</span>`
          : '<span class="session-note">Session closed.</span>';
    } else if (ev.type === 'error') {
      foot.innerHTML = `<span class="session-note session-note--err">${escapeHtml(ev.error)}</span>`;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      const line = part
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (!line) continue;
      try {
        handle(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
  }

  card.classList.remove('is-live');
  packetEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pkt="copy"]');
    if (!btn || !packet) return;
    const text = [
      packet.decision,
      '',
      (packet.plan || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
      '',
      (packet.actions || []).map((a) => `- ${a.owner}: ${a.action}`).join('\n'),
    ].join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = 'Copy packet'), 1200);
    });
  });

  return { packet, vaultPath };
}

window.__boardSession = { runBoardSession };
