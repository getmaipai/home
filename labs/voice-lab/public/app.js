const $ = (selector) => document.querySelector(selector);
const status = $('#status');
let ws, stream, source, node;
let vadMode = 'Connected';
const readSaved = () => { try { return JSON.parse(localStorage.voiceLab || '{}'); } catch { return {}; } };
const save = (value) => { try { localStorage.voiceLab = JSON.stringify(value); } catch {} };
const prefs = readSaved();
if (prefs.output) $('#output').value = prefs.output;
if (prefs.echoSetting) $('#echoSetting').value = prefs.echoSetting;
if (prefs.silenceMs) $('#silence').value = prefs.silenceMs;
if (prefs.turnThreshold) $('#threshold').value = prefs.turnThreshold;
if (typeof prefs.earlyStart === 'boolean') $('#early').checked = prefs.earlyStart;
if (prefs.echoThreshold) $('#echoThreshold').value = prefs.echoThreshold;
if (prefs.talkOver) $('#talkOver').value = prefs.talkOver;
if (prefs.toolDelay) $('#toolDelay').value = prefs.toolDelay;
if (prefs.netSim) $('#netSim').value = prefs.netSim;
if (typeof prefs.localDuck === 'boolean') $('#localDuck').checked = prefs.localDuck;

$('#start').onclick = async () => {
  const secret = $('#secret').value || sessionStorage.labSecret;
  if (!secret) { status.textContent = 'Enter the secret first.'; return; }
  status.textContent = 'Starting. Allow the microphone if asked.';
  sessionStorage.labSecret = secret;
  const echoValue = $('#echoSetting').value;
  const echoSetting = echoValue === 'true' ? true : echoValue === 'false' ? false : echoValue;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: echoSetting, noiseSuppression: false, autoGainControl: false } });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
  }
  const ctx = window.__voiceCtx;
  await ctx.resume();
  await ctx.audioWorklet.addModule('mic-worklet.js');
  source = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, 'voice-mic');
  source.connect(node);
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.binaryType = 'arraybuffer';
  const active = new Map();
  const chunkTexts = new Map();
  const playedTimes = [];
  let thinkTimer = 0;
  let currentTurn = 0, replyFinished = false, endSent = false, firstPlayedTurn = -1;
  const finishTurnIfReady = (turn) => {
    if (replyFinished && active.size === 0 && !endSent && ws?.readyState === 1) {
      endSent = true;
      ws.send(JSON.stringify({ t: 'played_end', turn }));
    }
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', secret, proto: 2 }));
  const rtts = []; setInterval(() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'ping', at: performance.now() })); }, 2000);
  setInterval(() => {
    for (const playback of active.values()) {
      if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'played', turn: playback.turn, chunk: playback.chunk, ms: Math.max(0, (ctx.currentTime - playback.start) * 1000) }));
    }
  }, 100);
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') {
      clearTimeout(thinkTimer); window.__stopTick?.();
      const view = new DataView(event.data);
      const turn = view.getUint32(0, true), index = view.getUint16(4, true), flags = view.getUint16(6, true);
      const pcm = new Int16Array(event.data, 8);
      const samples = Float32Array.from(pcm, (sample) => sample / 32768);
      const scheduled = window.__playPcm(samples, 24000);
      const key = `${turn}:${index}`;
      currentTurn = turn;
      if (!active.has(key)) active.set(key, { turn, chunk: index, start: scheduled.at });
      if (firstPlayedTurn !== turn) { firstPlayedTurn = turn; setTimeout(() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'played', turn, chunk: index, ms: 1 })); }, Math.max(0, (scheduled.at - ctx.currentTime) * 1000)); }
      const chunk = chunkTexts.get(key);
      if (chunk && !chunk.emitted) {
        chunk.emitted = true;
        window.__voiceLabListener?.({ type: 'chunk', turn, index, text: chunk.text, startTime: scheduled.at });
      }
      window.__voiceLabListener?.({ type: 'audio', samples, rate: 24000, at: scheduled.at });
      if (flags & 1) {
        setTimeout(() => {
          active.delete(key);
          chunkTexts.delete(key);
          window.__voiceLabListener?.({ type: 'chunkEnd' });
          finishTurnIfReady(turn);
        }, Math.max(0, (scheduled.at + scheduled.duration - ctx.currentTime) * 1000));
      }
      return;
    }
    const message = JSON.parse(event.data);
    if (message.t === 'state') {
      if (message.vad) vadMode = message.vad;
      const labels = { idle: 'Idle', user_speaking: 'Listening', maybe_done: 'Listening', thinking: 'Thinking', speaking: 'Speaking', paused: 'Listening', looking: 'Looking that up' };
      status.textContent = `${vadMode} · ${labels[message.state] || 'Connected'}`;
      $('#light').textContent = labels[message.state] || 'Connected';
      $('#light').dataset.state = message.state;
      clearTimeout(thinkTimer);
      if (message.state === 'thinking') thinkTimer = setTimeout(() => window.__startTick?.(), 900);
      else if (message.state !== 'speaking') window.__stopTick?.();
    }
    if (message.t === 'partial') $('#partial').textContent = message.text;
    if (message.t === 'final') { $('#final').textContent = message.text; $('#partial').textContent = ''; $('#reply').textContent = ''; }
    if (message.t === 'chunk') {
      if (message.turn !== currentTurn) { currentTurn = message.turn; replyFinished = false; endSent = false; }
      chunkTexts.set(`${message.turn}:${message.chunk}`, { text: message.text, emitted: false });
      $('#reply').textContent += (message.chunk ? ' ' : '') + message.text;
    }
    if (message.t === 'reply_final') {
      $('#reply').textContent = message.text;
      replyFinished = true;
      finishTurnIfReady(message.turn);
    }
    if (message.t === 'duck') window.__duck();
    if (message.t === 'pause') window.__pause();
    if (message.t === 'tool_start') { $('#light').textContent = 'Looking that up'; window.__startTick(); }
    if (message.t === 'tool_end') { $('#toolWait').textContent = (message.ms / 1000).toFixed(2) + ' s'; }
    if (message.t === 'pong') { const rtt = performance.now() - message.at; rtts.push(rtt); if (rtts.length > 8) rtts.shift(); $('#link').textContent = `${rtt.toFixed(0)} ms`; }
    if (message.t === 'pause') window.__pause();
    if (message.t === 'tool_start') { $('#light').textContent = 'Looking that up'; window.__startTick(); }
    if (message.t === 'tool_end') { $('#toolWait').textContent = (message.ms / 1000).toFixed(2) + ' s'; }
    if (message.t === 'pong') { const rtt = performance.now() - message.at; rtts.push(rtt); if (rtts.length > 8) rtts.shift(); $('#link').textContent = `${rtt.toFixed(0)} ms`; }
    if (message.t === 'resume') { window.__stopTick(); window.__resume(); }
    if (message.t === 'stop') { window.__stopPlayback(); active.clear(); window.__voiceLabListener?.({ type: 'stop' }); }
    if (message.t === 'timing') {
      if (Number.isFinite(message.t_first_audio_played)) {
        playedTimes.push(message.t_first_audio_played);
        if (playedTimes.length > 31) playedTimes.shift();
        const sorted = [...playedTimes].sort((a, b) => a - b);
        message.median_t_first_audio_played = sorted[Math.floor(sorted.length / 2)];
      }
      const sec = (v) => Number.isFinite(v) ? (v / 1000).toFixed(2) + ' s' : '-';
      if (Number.isFinite(message.t_first_audio_played)) { $('#firstSound').textContent = (message.t_first_audio_played / 1000).toFixed(2); $('#median').textContent = sec(message.median_t_first_audio_played) + ' over ' + playedTimes.length + (playedTimes.length === 1 ? ' turn' : ' turns'); }
      $('#tCommit').textContent = sec(message.t_commit); $('#tToken').textContent = sec(message.t_llm_first_token); $('#tVoice').textContent = sec(message.t_tts_first_byte);
      if (Number.isFinite(message.t_tool_start) && Number.isFinite(message.t_tool_end)) $('#toolWait').textContent = ((message.t_tool_end - message.t_tool_start) / 1000).toFixed(2) + ' s';
      if (Number.isFinite(message.t_duck) || Number.isFinite(message.t_stop_sent)) $('#tCut').textContent = sec(message.t_duck) + ' / ' + sec(message.t_stop_sent);
      $('#timings pre').textContent = JSON.stringify(message, null, 2);
    }
    if (message.t === 'warm') { const el = document.querySelector('#warm'); if (el) el.textContent = (el.textContent === '-' ? '' : el.textContent + ', ') + message.part + ' ' + (message.ms / 1000).toFixed(1) + ' s'; }
    if (message.t === 'error') status.textContent = 'The reply could not be completed.';
  };
  node.port.onmessage = (event) => { if (ws?.readyState === 1) ws.send(event.data); };
  $('#start').disabled = true;
  $('#stop').disabled = false;
  $('#output').onchange = () => window.__configureOutput($('#output').value);
  window.__configureOutput($('#output').value);
};
$('#stop').onclick = () => ws?.send(JSON.stringify({ t: 'stop' }));
for (const id of ['silence', 'threshold', 'early', 'echoThreshold', 'output', 'echoSetting', 'talkOver', 'toolDelay', 'netSim', 'localDuck']) {
  $('#' + id).onchange = () => {
    const sim = $('#netSim').value; const values = { talkOverMode: $('#talkOver').value, toolDelayMs: +$('#toolDelay').value, netSim: sim === 'phone' ? { delayMs: 80, jitterMs: 30, burstEveryMs: 0, burstStallMs: 0 } : sim === 'hotel' ? { delayMs: 200, jitterMs: 120, burstEveryMs: 7000, burstStallMs: 800 } : { delayMs: 0, jitterMs: 0, burstEveryMs: 0, burstStallMs: 0 }, checkSilenceMs: +$('#silence').value, turnThreshold: +$('#threshold').value, earlyStart: $('#early').checked, echoThreshold: +$('#echoThreshold').value, outputPath: $('#output').value, echoSetting: $('#echoSetting').value };
    if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'config', values }));
    if (id === 'output') window.__configureOutput($('#output').value);
    save({ talkOver: $('#talkOver').value, toolDelay: +$('#toolDelay').value, netSim: $('#netSim').value, localDuck: $('#localDuck').checked, output: $('#output').value, echoSetting: $('#echoSetting').value, silenceMs: +$('#silence').value, turnThreshold: +$('#threshold').value, earlyStart: $('#early').checked, echoThreshold: +$('#echoThreshold').value });
  };
}

// Voice choice, voice engine and "record my voice".
const labSecret = () => $('#secret').value || sessionStorage.labSecret || '';
const api = (path, init = {}) => fetch(path, { ...init, headers: { ...(init.headers || {}), 'x-lab-secret': labSecret() } });
const sendVoiceConfig = () => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'config', values: { voice: $('#voice').value, useStyles: $('#useStyles').checked } })); try { localStorage.voiceLabVoice = $('#voice').value; } catch {} };
async function loadVoices() {
  if (!labSecret()) return;
  try {
    const voices = (await (await api('/api/voices')).json()).voices || [];
    const keep = $('#voice').value || (() => { try { return localStorage.voiceLabVoice; } catch { return ''; } })();
    $('#voice').innerHTML = '<option value="builtin">Built-in</option>' + voices.map((v) => '<option value="' + v.id + '">' + (v.id === 'me' ? 'My voice' : v.id === 'ref_f' ? 'Sample voice (made up)' : v.id) + (v.styles?.length ? ' (has styled samples)' : '') + '</option>').join('');
    if ([...$('#voice').options].some((o) => o.value === keep)) $('#voice').value = keep;
    const models = await (await api('/api/voice-models')).json();
    $('#voiceModel').innerHTML = Object.entries(models.models || {}).map(([key, m]) => '<option value="' + key + '"' + (m.loaded ? ' selected' : '') + '>' + key + (m.slow ? ' (slow)' : '') + '</option>').join('');
  } catch { $('#recordStatus').textContent = 'The voice engine did not answer.'; }
}
$('#secret').addEventListener('change', loadVoices); $('#start').addEventListener('click', () => setTimeout(() => { loadVoices().then(sendVoiceConfig); }, 1500)); loadVoices();
$('#voice').onchange = sendVoiceConfig; $('#useStyles').onchange = sendVoiceConfig;
$('#voiceModel').onchange = async () => { $('#recordStatus').textContent = 'Switching voice engine. This takes a few seconds.'; try { const r = await api('/api/voice-model', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: $('#voiceModel').value }) }); $('#recordStatus').textContent = r.ok ? 'Voice engine ready.' : 'That voice engine could not load. Pick another one.'; } catch { $('#recordStatus').textContent = 'The voice engine did not answer.'; } loadVoices(); };
$('#recordVoice').onclick = async () => {
  if (!labSecret()) { $('#recordStatus').textContent = 'Enter the secret first.'; return; }
  let micStream;
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); } catch { $('#recordStatus').textContent = 'The microphone was not allowed. Allow it in the browser and try again.'; return; }
  const ctx = window.__voiceCtx; await ctx.resume();
  const src = ctx.createMediaStreamSource(micStream), proc = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
  const parts = []; let count = 0; const want = ctx.sampleRate * 10;
  proc.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); parts.push(new Float32Array(d)); count += d.length; $('#recordStatus').textContent = 'Recording. Keep talking: ' + Math.max(0, Math.ceil((want - count) / ctx.sampleRate)) + ' s left.'; if (count >= want) finish(); };
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  let done = false;
  const finish = async () => {
    if (done) return; done = true; proc.disconnect(); src.disconnect(); micStream.getTracks().forEach((t) => t.stop());
    const all = new Float32Array(count); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
    const wav = new DataView(new ArrayBuffer(44 + all.length * 2)); const put = (at, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(at + i, s.charCodeAt(i)); };
    put(0, 'RIFF'); wav.setUint32(4, 36 + all.length * 2, true); put(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, ctx.sampleRate, true); wav.setUint32(28, ctx.sampleRate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); put(36, 'data'); wav.setUint32(40, all.length * 2, true);
    for (let i = 0; i < all.length; i++) wav.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(all[i] * 32767))), true);
    $('#recordStatus').textContent = 'Making your voice. This takes a few seconds.';
    const form = new FormData(); form.append('file', new Blob([wav.buffer], { type: 'audio/wav' }), 'me.wav'); form.append('id', 'me');
    try { const r = await api('/api/voices', { method: 'POST', body: form }); if (!r.ok) throw 0; await loadVoices(); $('#voice').value = 'me'; sendVoiceConfig(); $('#recordStatus').textContent = 'Your voice is ready and selected.'; }
    catch { $('#recordStatus').textContent = 'Your voice could not be made. Record again somewhere quieter, speaking for the full 10 seconds.'; }
  };
};
