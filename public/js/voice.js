/**
 * voice.js — Live voice agent
 * Primary: xAI Grok Voice Agent (ephemeral token + tools)
 * Also: Gemini Live · OpenAI Realtime
 * Docs: https://docs.x.ai/developers/model-capabilities/audio/voice-agent
 */

const VoiceModule = (() => {
  let ws = null;
  let isConnected = false;
  let protocol = 'xai-realtime';
  let captureContext = null;
  let mediaStream = null;
  let scriptProcessor = null;
  let playbackContext = null;
  let nextStartTime = 0;
  let sampleRate = 24000;
  let voiceBtn, voiceWidget, voiceIndicator, voiceTranscript;
  let voiceMinimizeBtn, voiceStopBtn, voiceProviderLabel, voiceToolLog;
  let pendingFunctionCalls = [];
  let sessionReady = false;

  function headers() {
    return window.__boardroomSettings?.getProviderKeysHeader?.() || {};
  }

  function preferredProvider() {
    const s = window.__boardroomSettings?.getSettings?.() || {};
    return s.voiceProvider || s.voiceAgent?.provider || 'xai';
  }

  function voiceAgentSettings() {
    const s = window.__boardroomSettings?.getSettings?.() || {};
    return s.voiceAgent || {};
  }

  function init() {
    voiceBtn = document.getElementById('voiceBtn');
    voiceWidget = document.getElementById('voiceWidget');
    voiceIndicator = document.getElementById('voiceIndicator');
    voiceTranscript = document.getElementById('voiceTranscript');
    voiceMinimizeBtn = document.getElementById('voiceMinimizeBtn');
    voiceStopBtn = document.getElementById('voiceStopBtn');
    voiceProviderLabel = document.getElementById('voiceProviderLabel');
    voiceToolLog = document.getElementById('voiceToolLog');

    if (!voiceBtn) return;

    voiceBtn.addEventListener('click', toggleVoice);
    voiceMinimizeBtn?.addEventListener('click', () => voiceWidget?.classList.toggle('minimized'));
    voiceStopBtn?.addEventListener('click', disconnect);

    refreshStatus();
    window.addEventListener('boardroom:settings', refreshStatus);
  }

  function refreshStatus() {
    fetch('/api/voice/status', { headers: headers() })
      .then((r) => r.json())
      .then((data) => {
        if (!data.voiceEnabled) {
          voiceBtn.title = 'Add xAI API key in Settings to enable Grok Voice Agent';
          voiceBtn.classList.add('disabled');
        } else {
          voiceBtn.classList.remove('disabled');
          voiceBtn.title = 'Live voice agent (Grok Voice / Gemini / ChatGPT)';
        }
      })
      .catch(() => {});
  }

  function toggleVoice() {
    if (isConnected) disconnect();
    else connect();
  }

  async function connect() {
    try {
      voiceWidget?.classList.remove('minimized');
      setStatus('connecting');
      showWidget(true);
      clearToolLog();
      const provider = preferredProvider();
      if (voiceProviderLabel) {
        voiceProviderLabel.textContent =
          provider === 'xai' ? 'Grok Voice' : provider === 'openai' ? 'ChatGPT' : provider;
      }

      const res = await fetch('/api/voice/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({
          provider,
          voiceAgent: voiceAgentSettings(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Voice token failed');
      }
      const cfg = await res.json();
      protocol = cfg.protocol || 'xai-realtime';
      sampleRate = cfg.sampleRate || 24000;

      if (protocol === 'xai-realtime') {
        await connectXai(cfg);
      } else if (protocol === 'gemini-bidi') {
        await connectGemini(cfg);
      } else if (protocol === 'openai-realtime') {
        await connectOpenAIRealtime(cfg);
      } else {
        throw new Error(`Unsupported voice protocol: ${protocol}`);
      }
    } catch (err) {
      console.error('[Voice]', err);
      setStatus('error');
      if (voiceTranscript) voiceTranscript.textContent = err.message;
      setTimeout(disconnect, 3200);
    }
  }

  // ── xAI Grok Voice Agent ────────────────────────────────────────────────
  async function connectXai(cfg) {
    sessionReady = false;
    pendingFunctionCalls = [];
    // Browser cannot set Authorization headers on WebSocket — use ephemeral subprotocol
    const protocols = [`xai-client-secret.${cfg.clientSecret}`];
    ws = new WebSocket(cfg.wsUrl, protocols);

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      // Configure full agent session (tools, VAD, voice, instructions)
      ws.send(
        JSON.stringify({
          type: 'session.update',
          session: cfg.session,
        })
      );
    };

    ws.onmessage = async (ev) => {
      // Binary audio frames (if transport=binary)
      if (ev.data instanceof ArrayBuffer) {
        setStatus('speaking');
        playPcmBuffer(ev.data, sampleRate);
        return;
      }
      let data;
      try {
        data = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text());
      } catch {
        return;
      }
      await handleXaiEvent(data, cfg);
    };

    ws.onerror = () => {
      setStatus('error');
      if (voiceTranscript) voiceTranscript.textContent = 'WebSocket error — check xAI key / network';
    };
    ws.onclose = (ev) => {
      if (!sessionReady && voiceTranscript) {
        voiceTranscript.textContent = `Disconnected (${ev.code}) — verify xAI Voice access`;
      }
      cleanup();
    };
  }

  async function handleXaiEvent(data, cfg) {
    const t = data.type;

    if (t === 'session.created') {
      // Wait for session.updated so tools/voice config are applied first
      return;
    }

    if (t === 'session.updated') {
      if (!sessionReady) {
        sessionReady = true;
        isConnected = true;
        setStatus('listening');
        await startMicRealtime();
        if (cfg.greetOnConnect) {
          ws.send(
            JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: cfg.greetText || 'Hello — introduce yourself briefly as JARVIS.',
                  },
                ],
              },
            })
          );
          ws.send(JSON.stringify({ type: 'response.create' }));
        }
      }
      return;
    }

    if (t === 'error') {
      console.error('[xAI voice]', data);
      const msg = data.error?.message || data.message || 'Voice error';
      if (voiceTranscript) voiceTranscript.textContent = msg;
      setStatus('error');
      return;
    }

    if (t === 'input_audio_buffer.speech_started') {
      // Barge-in: stop queued playback
      resetPlayback();
      setStatus('listening');
      return;
    }

    if (t === 'input_audio_buffer.speech_stopped') {
      setStatus('listening');
      return;
    }

    // Audio output (xAI event names)
    if (
      (t === 'response.output_audio.delta' || t === 'response.audio.delta') &&
      (data.delta || data.audio)
    ) {
      setStatus('speaking');
      playPcmBase64(data.delta || data.audio, sampleRate);
      return;
    }

    // Transcripts
    if (
      t === 'response.output_audio_transcript.delta' ||
      t === 'response.audio_transcript.delta' ||
      t === 'response.text.delta' ||
      t === 'response.output_text.delta'
    ) {
      const delta = data.delta || '';
      if (voiceTranscript && delta) {
        const prev = voiceTranscript.dataset.partial || '';
        voiceTranscript.dataset.partial = prev + delta;
        voiceTranscript.textContent = voiceTranscript.dataset.partial;
      }
      return;
    }

    if (
      t === 'response.output_audio_transcript.done' ||
      t === 'response.audio_transcript.done' ||
      t === 'response.done'
    ) {
      if (voiceTranscript) voiceTranscript.dataset.partial = '';
    }

    // User input transcription
    if (t === 'conversation.item.input_audio_transcription.completed' && data.transcript) {
      appendToolLog('You', data.transcript);
    }

    // Function calling
    if (t === 'response.function_call_arguments.done') {
      pendingFunctionCalls.push({
        call_id: data.call_id,
        name: data.name,
        arguments: data.arguments,
      });
      logToolCall(data.name, data.arguments);
      return;
    }

    // MCP status
    if (t === 'response.mcp_call.in_progress') {
      appendToolLog('MCP', data.name || 'tool running…');
    }
    if (t === 'response.mcp_call.completed') {
      appendToolLog('MCP', `${data.name || 'tool'} done`);
    }
    if (t === 'response.mcp_call.failed') {
      appendToolLog('MCP', `failed: ${data.error || data.name || ''}`);
    }

    if (t === 'response.done') {
      if (pendingFunctionCalls.length) {
        const batch = pendingFunctionCalls.splice(0, pendingFunctionCalls.length);
        for (const call of batch) {
          await resolveFunctionCall(call);
        }
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'response.create' }));
        }
      } else {
        setStatus('listening');
      }
    }
  }

  async function resolveFunctionCall(call) {
    let args = {};
    try {
      args = typeof call.arguments === 'string' ? JSON.parse(call.arguments || '{}') : call.arguments || {};
    } catch {
      args = {};
    }
    appendToolLog('Tool', `${call.name}…`);
    let output;
    try {
      const res = await fetch('/api/voice/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({
          name: call.name,
          arguments: args,
          call_id: call.call_id,
        }),
      });
      const data = await res.json();
      output = data.ok ? data.result : { error: data.error || 'tool failed' };
      appendToolLog('Tool', `${call.name} ✓`);
    } catch (e) {
      output = { error: e.message };
      appendToolLog('Tool', `${call.name} ✗ ${e.message}`);
    }

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(output),
          },
        })
      );
    }
  }

  // ── Gemini ──────────────────────────────────────────────────────────────
  async function connectGemini(cfg) {
    ws = new WebSocket(cfg.wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify(cfg.setupMessage));
    };
    ws.onmessage = async (ev) => {
      let data;
      try {
        data = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text());
      } catch {
        return;
      }
      if (data.setupComplete) {
        isConnected = true;
        setStatus('listening');
        await startMicGemini();
        return;
      }
      const parts = data.serverContent?.modelTurn?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) playPcmBase64(part.inlineData.data, 24000);
        if (part.text && voiceTranscript) voiceTranscript.textContent = part.text;
      }
      const outTx = data.serverContent?.outputTranscription?.text;
      if (outTx && voiceTranscript) voiceTranscript.textContent = outTx;
      if (data.serverContent?.modelTurn) setStatus('speaking');
      if (data.serverContent?.turnComplete) setStatus('listening');
    };
    ws.onerror = () => setStatus('error');
    ws.onclose = () => cleanup();
  }

  // ── OpenAI Realtime ─────────────────────────────────────────────────────
  async function connectOpenAIRealtime(cfg) {
    ws = new WebSocket(cfg.wsUrl, [
      'realtime',
      `openai-insecure-api-key.${cfg.auth}`,
      'openai-beta.realtime-v1',
    ]);

    ws.onopen = () => {
      isConnected = true;
      setStatus('listening');
      ws.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            instructions: cfg.instructions,
            voice: cfg.voice || 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            turn_detection: { type: 'server_vad' },
            modalities: ['text', 'audio'],
          },
        })
      );
      startMicRealtime();
    };

    ws.onmessage = async (ev) => {
      let data;
      try {
        data = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text());
      } catch {
        return;
      }
      if ((data.type === 'response.audio.delta' || data.type === 'response.output_audio.delta') && data.delta) {
        setStatus('speaking');
        playPcmBase64(data.delta, 24000);
      }
      if (
        (data.type === 'response.audio_transcript.delta' ||
          data.type === 'response.output_audio_transcript.delta') &&
        data.delta &&
        voiceTranscript
      ) {
        voiceTranscript.textContent = (voiceTranscript.textContent || '') + data.delta;
      }
      if (data.type === 'response.done') setStatus('listening');
      if (data.type === 'error') {
        if (voiceTranscript) voiceTranscript.textContent = data.error?.message || 'Realtime error';
      }
    };
    ws.onerror = () => setStatus('error');
    ws.onclose = () => cleanup();
  }

  // ── Mic capture ─────────────────────────────────────────────────────────
  async function startMicGemini() {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    captureContext = new AudioContext({ sampleRate: 16000 });
    await captureContext.resume();
    const source = captureContext.createMediaStreamSource(mediaStream);
    scriptProcessor = captureContext.createScriptProcessor(4096, 1, 1);
    scriptProcessor.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPCM(input);
      const b64 = arrayBufferToBase64(pcm.buffer);
      ws.send(
        JSON.stringify({
          realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: b64 }] },
        })
      );
    };
    source.connect(scriptProcessor);
    scriptProcessor.connect(captureContext.destination);
  }

  async function startMicRealtime() {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    captureContext = new AudioContext({ sampleRate });
    await captureContext.resume();
    const source = captureContext.createMediaStreamSource(mediaStream);
    // Downsample if device rate differs
    const procRate = captureContext.sampleRate;
    scriptProcessor = captureContext.createScriptProcessor(4096, 1, 1);
    scriptProcessor.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      let input = e.inputBuffer.getChannelData(0);
      if (procRate !== sampleRate) {
        input = downsampleBuffer(input, procRate, sampleRate);
      }
      const pcm = floatTo16BitPCM(input);
      const b64 = arrayBufferToBase64(pcm.buffer);
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
    };
    source.connect(scriptProcessor);
    // Keep processor alive without audible feedback
    const mute = captureContext.createGain();
    mute.gain.value = 0;
    scriptProcessor.connect(mute);
    mute.connect(captureContext.destination);
  }

  function downsampleBuffer(buffer, fromRate, toRate) {
    if (fromRate === toRate) return buffer;
    const ratio = fromRate / toRate;
    const newLen = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      result[i] = buffer[Math.floor(i * ratio)] || 0;
    }
    return result;
  }

  // ── Playback ────────────────────────────────────────────────────────────
  function resetPlayback() {
    try {
      playbackContext?.close();
    } catch {
      /* ignore */
    }
    playbackContext = null;
    nextStartTime = 0;
  }

  function playPcmBase64(b64, rate) {
    try {
      const raw = atob(b64);
      const buf = new ArrayBuffer(raw.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
      playPcmBuffer(buf, rate);
    } catch (e) {
      console.warn('[Voice] playback', e);
    }
  }

  function playPcmBuffer(arrayBuffer, rate) {
    try {
      if (!playbackContext || playbackContext.state === 'closed') {
        playbackContext = new AudioContext({ sampleRate: rate });
        nextStartTime = 0;
      }
      if (playbackContext.state === 'suspended') playbackContext.resume();
      const int16 = new Int16Array(arrayBuffer.byteLength % 2 ? arrayBuffer.slice(0, arrayBuffer.byteLength - 1) : arrayBuffer);
      // If not aligned as Int16Array view:
      const view = new Int16Array(arrayBuffer);
      const float32 = new Float32Array(view.length);
      for (let i = 0; i < view.length; i++) float32[i] = view[i] / 32768;
      const audioBuf = playbackContext.createBuffer(1, float32.length, rate);
      audioBuf.copyToChannel(float32, 0);
      const src = playbackContext.createBufferSource();
      src.buffer = audioBuf;
      src.connect(playbackContext.destination);
      const now = playbackContext.currentTime;
      if (nextStartTime < now) nextStartTime = now + 0.02;
      src.start(nextStartTime);
      nextStartTime += audioBuf.duration;
    } catch (e) {
      console.warn('[Voice] pcm play', e);
    }
  }

  function floatTo16BitPCM(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function disconnect() {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    cleanup();
  }

  function cleanup() {
    isConnected = false;
    sessionReady = false;
    ws = null;
    pendingFunctionCalls = [];
    try {
      scriptProcessor?.disconnect();
      mediaStream?.getTracks().forEach((t) => t.stop());
      captureContext?.close();
    } catch {
      /* ignore */
    }
    scriptProcessor = null;
    mediaStream = null;
    captureContext = null;
    resetPlayback();
    setStatus('idle');
    showWidget(false);
    document.getElementById('composerShell')?.classList.remove('is-voice');
  }

  function setStatus(s) {
    voiceIndicator?.setAttribute('data-status', s);
    voiceBtn?.classList.toggle('active', s === 'listening' || s === 'speaking' || s === 'connecting');
    document.getElementById('composerShell')?.classList.toggle('is-voice', s === 'listening' || s === 'speaking');
    const map = {
      idle: '',
      connecting: 'Connecting to Grok Voice…',
      listening: 'Listening…',
      speaking: 'Speaking…',
      error: 'Voice error',
    };
    if (voiceTranscript && map[s] && s !== 'speaking') {
      // Don't wipe live transcript while speaking
      if (s === 'listening' && voiceTranscript.dataset.partial) return;
      voiceTranscript.textContent = map[s];
    }
  }

  function showWidget(show) {
    if (!voiceWidget) return;
    voiceWidget.hidden = !show;
  }

  function clearToolLog() {
    if (voiceToolLog) voiceToolLog.innerHTML = '';
  }

  function appendToolLog(kind, text) {
    if (!voiceToolLog) return;
    const row = document.createElement('div');
    row.className = 'voice-tool-row';
    row.innerHTML = `<span class="voice-tool-kind">${escapeHtml(kind)}</span> ${escapeHtml(String(text).slice(0, 180))}`;
    voiceToolLog.prepend(row);
    while (voiceToolLog.children.length > 8) voiceToolLog.lastChild.remove();
  }

  function logToolCall(name, args) {
    appendToolLog('Call', `${name}(${String(args || '').slice(0, 80)})`);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>');
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init, connect, disconnect };
})();
