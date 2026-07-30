/**
 * voice.js — Multi-provider voice (Gemini Live · OpenAI Realtime · Grok/xAI)
 */

const VoiceModule = (() => {
  let ws = null;
  let isConnected = false;
  let protocol = 'gemini-bidi';
  let captureContext = null;
  let mediaStream = null;
  let scriptProcessor = null;
  let playbackContext = null;
  let nextStartTime = 0;
  let voiceBtn, voiceWidget, voiceIndicator, voiceTranscript;
  let voiceMinimizeBtn, voiceStopBtn, voiceProviderLabel;

  function headers() {
    return window.__boardroomSettings?.getProviderKeysHeader?.() || {};
  }

  function preferredProvider() {
    return window.__boardroomSettings?.getSettings?.()?.voiceProvider || 'gemini';
  }

  function init() {
    voiceBtn = document.getElementById('voiceBtn');
    voiceWidget = document.getElementById('voiceWidget');
    voiceIndicator = document.getElementById('voiceIndicator');
    voiceTranscript = document.getElementById('voiceTranscript');
    voiceMinimizeBtn = document.getElementById('voiceMinimizeBtn');
    voiceStopBtn = document.getElementById('voiceStopBtn');
    voiceProviderLabel = document.getElementById('voiceProviderLabel');

    if (!voiceBtn) return;

    voiceBtn.addEventListener('click', toggleVoice);
    voiceMinimizeBtn?.addEventListener('click', () => voiceWidget?.classList.toggle('minimized'));
    voiceStopBtn?.addEventListener('click', disconnect);

    fetch('/api/voice/status', { headers: headers() })
      .then((r) => r.json())
      .then((data) => {
        if (!data.voiceEnabled) {
          voiceBtn.title = 'Add a voice API key in Settings (Gemini / OpenAI / xAI)';
          voiceBtn.classList.add('disabled');
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
      const provider = preferredProvider();
      if (voiceProviderLabel) voiceProviderLabel.textContent = provider;

      const res = await fetch('/api/voice/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ provider }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Voice token failed');
      }
      const cfg = await res.json();
      protocol = cfg.protocol || 'gemini-bidi';

      if (protocol === 'gemini-bidi') {
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
      setTimeout(disconnect, 2500);
    }
  }

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

  async function connectOpenAIRealtime(cfg) {
    // OpenAI / xAI realtime websocket
    ws = new WebSocket(cfg.wsUrl, ['realtime', `openai-insecure-api-key.${cfg.auth}`, 'openai-beta.realtime-v1']);
    // Some clients use Authorization via subprotocol; also try without if fails

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
      if (data.type === 'response.audio.delta' && data.delta) {
        setStatus('speaking');
        playPcmBase64(data.delta, 24000);
      }
      if (data.type === 'response.audio_transcript.delta' && data.delta && voiceTranscript) {
        voiceTranscript.textContent = (voiceTranscript.textContent || '') + data.delta;
      }
      if (data.type === 'response.done') setStatus('listening');
      if (data.type === 'error') {
        console.error('[Voice realtime]', data);
        if (voiceTranscript) voiceTranscript.textContent = data.error?.message || 'Realtime error';
      }
    };
    ws.onerror = () => setStatus('error');
    ws.onclose = () => cleanup();
  }

  async function startMicGemini() {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    captureContext = new AudioContext({ sampleRate: 16000 });
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
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    captureContext = new AudioContext({ sampleRate: 24000 });
    const source = captureContext.createMediaStreamSource(mediaStream);
    scriptProcessor = captureContext.createScriptProcessor(4096, 1, 1);
    scriptProcessor.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPCM(input);
      const b64 = arrayBufferToBase64(pcm.buffer);
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
    };
    source.connect(scriptProcessor);
    scriptProcessor.connect(captureContext.destination);
  }

  function playPcmBase64(b64, sampleRate) {
    try {
      if (!playbackContext) playbackContext = new AudioContext({ sampleRate });
      const raw = atob(b64);
      const buf = new ArrayBuffer(raw.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
      const int16 = new Int16Array(buf);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
      const audioBuf = playbackContext.createBuffer(1, float32.length, sampleRate);
      audioBuf.copyToChannel(float32, 0);
      const src = playbackContext.createBufferSource();
      src.buffer = audioBuf;
      src.connect(playbackContext.destination);
      const now = playbackContext.currentTime;
      if (nextStartTime < now) nextStartTime = now;
      src.start(nextStartTime);
      nextStartTime += audioBuf.duration;
    } catch (e) {
      console.warn('[Voice] playback', e);
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
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
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
    ws = null;
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
      connecting: 'Connecting…',
      listening: 'Listening…',
      speaking: 'Speaking…',
      error: 'Voice error',
    };
    if (voiceTranscript && map[s] && s !== 'speaking') voiceTranscript.textContent = map[s];
  }

  function showWidget(show) {
    if (!voiceWidget) return;
    voiceWidget.hidden = !show;
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init, connect, disconnect };
})();
