/**
 * upload.js — Local attach without opening Google Drive by default
 *
 * iOS/Android show Drive only when the *document* picker opens (broad accept / PDFs).
 * Primary actions use image/* or capture → Photo library / Camera (no Drive).
 */

let pendingFiles = [];

export function initUpload() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUploadDom);
    return;
  }
  initUploadDom();
}

function initUploadDom() {
  const attachBtn = document.getElementById('attachBtn');
  const sheet = document.getElementById('attachSheet');
  const sheetClose = document.getElementById('attachSheetClose');
  const pickPhotos = document.getElementById('attachPickPhotos');
  const pickCamera = document.getElementById('attachPickCamera');
  const pickDocs = document.getElementById('attachPickDocs');
  const pickLocal = document.getElementById('attachPickLocal'); // legacy
  const docsWarn = document.getElementById('attachDocsWarn');

  const inputPhotos = document.getElementById('fileInputPhotos') || document.getElementById('fileInput');
  const inputCamera = document.getElementById('fileInputCamera');
  const inputDocs = document.getElementById('fileInputDocs');

  // Lock photo inputs to images only (critical: never mix PDF accept on photo input)
  if (inputPhotos) {
    inputPhotos.setAttribute('accept', 'image/*');
    inputPhotos.removeAttribute('capture');
    inputPhotos.multiple = true;
  }
  if (inputCamera) {
    inputCamera.setAttribute('accept', 'image/*');
    inputCamera.setAttribute('capture', 'environment');
    inputCamera.multiple = false;
  }
  if (inputDocs) {
    inputDocs.setAttribute(
      'accept',
      '.pdf,.txt,.md,.csv,.docx,text/plain,text/csv,application/pdf'
    );
    inputDocs.removeAttribute('capture');
    inputDocs.multiple = true;
  }

  attachBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (docsWarn) docsWarn.hidden = true;
    if (sheet) {
      sheet.hidden = false;
      return;
    }
    // Fallback: photos only (never docs picker by default)
    openPicker(inputPhotos);
  });

  pickPhotos?.addEventListener('click', () => {
    if (sheet) sheet.hidden = true;
    openPicker(inputPhotos);
  });

  pickCamera?.addEventListener('click', () => {
    if (sheet) sheet.hidden = true;
    openPicker(inputCamera || inputPhotos);
  });

  pickDocs?.addEventListener('click', () => {
    // Show warning; require second tap or open with delay so user sees warn
    if (docsWarn && docsWarn.hidden) {
      docsWarn.hidden = false;
      pickDocs.textContent = 'Continue to Files (may list Drive)';
      return;
    }
    if (sheet) sheet.hidden = true;
    if (pickDocs) pickDocs.textContent = 'PDF / text files';
    openPicker(inputDocs || inputPhotos);
  });

  // Legacy single button
  pickLocal?.addEventListener('click', () => {
    if (sheet) sheet.hidden = true;
    openPicker(inputPhotos);
  });

  sheetClose?.addEventListener('click', () => {
    if (sheet) sheet.hidden = true;
    if (docsWarn) docsWarn.hidden = true;
    if (pickDocs) pickDocs.textContent = 'PDF / text files';
  });

  sheet?.addEventListener('click', (e) => {
    if (e.target === sheet) {
      sheet.hidden = true;
      if (docsWarn) docsWarn.hidden = true;
      if (pickDocs) pickDocs.textContent = 'PDF / text files';
    }
  });

  [inputPhotos, inputCamera, inputDocs].forEach((input) => {
    input?.addEventListener('change', (e) => {
      Array.from(e.target.files || []).forEach(addFile);
      e.target.value = '';
    });
  });

  document.getElementById('fileChips')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.file-chip-remove');
    if (btn) removeFile(parseInt(btn.dataset.index, 10));
  });

  const wrapper = document.querySelector('.input-wrapper');
  if (wrapper) {
    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      wrapper.classList.add('drag-over');
    });
    wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drag-over'));
    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      wrapper.classList.remove('drag-over');
      Array.from(e.dataTransfer.files || []).forEach(addFile);
    });
  }

  // Paste images from clipboard (desktop / some mobile)
  document.getElementById('chatInput')?.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) addFile(f);
      }
    }
  });

  document.getElementById('sendBtn')?.addEventListener('click', handleSendWithFiles, true);
}

function openPicker(input) {
  if (!input) {
    alert('File picker unavailable. Refresh the page.');
    return;
  }
  try {
    // Ensure we don't accidentally leave capture on photo library input
    if (input.id === 'fileInputPhotos' || input.id === 'fileInput') {
      input.removeAttribute('capture');
      input.setAttribute('accept', 'image/*');
    }
    input.click();
  } catch (err) {
    console.warn('[Upload] picker', err);
  }
}

function handleSendWithFiles(e) {
  if (pendingFiles.length === 0) return;
  e.stopImmediatePropagation();

  const chatInput = document.getElementById('chatInput');
  const text = chatInput?.value.trim() || '';
  if (chatInput) {
    chatInput.value = '';
    chatInput.style.height = 'auto';
  }
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) sendBtn.disabled = true;

  const fileNames = pendingFiles.map((f) => f.name).join(', ');
  const displayText = text ? `${text}\n\n_Attached: ${fileNames}_` : `_Attached: ${fileNames}_`;
  const boardroom = window.__boardroom;
  if (!boardroom) {
    alert('Error: Application not ready. Please refresh the page.');
    return;
  }
  boardroom.appendMessage?.('user', displayText);
  sendWithFiles(text);
}

async function sendWithFiles(textMessage) {
  const boardroom = window.__boardroom;
  if (!boardroom) return;
  const { state, appendMessage, showTyping, removeTyping } = boardroom;
  const formData = new FormData();
  pendingFiles.forEach((f) => formData.append('files', f));
  formData.append('sessionId', state.sessionId);
  if (textMessage) formData.append('message', textMessage);

  const extraHeaders = window.__boardroomSettings?.getProviderKeysHeader?.() || {};
  const typingEl = showTyping?.();
  if (state) state.isLoading = true;

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
      headers: { ...extraHeaders },
    });
    const data = await res.json();
    if (typingEl && removeTyping) removeTyping(typingEl);
    if (!res.ok) {
      appendMessage?.('assistant', `Upload error: ${data.error || 'Unknown error'}`, {
        role: 'jarvis',
        model: 'error',
      });
      return;
    }
    appendMessage?.('assistant', data.response, {
      role: data.role || 'jarvis',
      model: data.model,
      boardMember: data.boardMember,
    });
    clearPendingFiles();
  } catch (err) {
    if (typingEl && removeTyping) removeTyping(typingEl);
    appendMessage?.('assistant', `Upload failed: ${err.message}`, {
      role: 'jarvis',
      model: 'error',
    });
  } finally {
    if (state) state.isLoading = false;
  }
}

function addFile(file) {
  const ALLOWED = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  const okType =
    ALLOWED.includes(file.type) ||
    file.type.startsWith('image/') ||
    /\.(md|txt|csv|pdf|docx|jpe?g|png|webp|gif|heic)$/i.test(file.name);
  if (!okType) {
    alert(`Unsupported file type: ${file.name}`);
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    alert(`File too large (max 20MB): ${file.name}`);
    return;
  }
  if (pendingFiles.length >= 5) {
    alert('Maximum 5 files per upload.');
    return;
  }
  pendingFiles.push(file);
  renderFileChips();
  updateAttachBtnState();
}

function removeFile(index) {
  pendingFiles.splice(index, 1);
  renderFileChips();
  updateAttachBtnState();
}

function clearPendingFiles() {
  pendingFiles = [];
  renderFileChips();
  updateAttachBtnState();
}

function updateAttachBtnState() {
  const btn = document.getElementById('attachBtn');
  if (btn) btn.classList.toggle('has-files', pendingFiles.length > 0);
}

function renderFileChips() {
  const container = document.getElementById('fileChips');
  if (!container) return;
  container.hidden = pendingFiles.length === 0;
  container.innerHTML = pendingFiles
    .map((f, i) => {
      const icon = getFileIcon(f);
      const name = truncateName(f.name, 22);
      const size = formatBytes(f.size);
      return `
        <div class="file-chip">
          <span class="file-chip-icon">${icon}</span>
          <span class="file-chip-name">${escapeHtml(name)}</span>
          <span class="file-chip-size">${size}</span>
          <button type="button" class="file-chip-remove" data-index="${i}" aria-label="Remove file">&times;</button>
        </div>`;
    })
    .join('');
}

function getFileIcon(file) {
  if (file.type.startsWith('image/')) return 'IMG';
  if (file.type === 'application/pdf') return 'PDF';
  if (file.type === 'text/csv') return 'CSV';
  if (file.name.endsWith('.md')) return 'MD';
  if (file.type.includes('wordprocessingml')) return 'DOC';
  return 'TXT';
}

function truncateName(name, max) {
  if (name.length <= max) return name;
  const ext = name.lastIndexOf('.');
  if (ext > 0) return name.substring(0, max - 4) + '…' + name.substring(ext);
  return name.substring(0, max) + '…';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}
