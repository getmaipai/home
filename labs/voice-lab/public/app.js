import { TurnState } from "./turn-state.js";
import { LocalDuckDetector } from "./local-duck.js";
import { watchSocket } from "./reconnect.js";
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
  const turnState = new TurnState();
  const localDuckDetector = new LocalDuckDetector();
  const active = new Map();
  const chunkTexts = new Map();
  const playedTimes = [];
  let thinkTimer = 0, localRestoreTimer = 0, failedTurns = 0, turnCount = 0, localDuckSent = false;
  let currentTurn = 0, replyFinished = false, endSent = false, firstPlayedTurn = -1;
  const finishTurnIfReady = (turn) => {
    if (replyFinished && active.size === 0 && !endSent && turnState.isCurrent(turn) && ws?.readyState === 1) {
      endSent = true;
      ws.send(JSON.stringify({ t: 'played_end', turn }));
    }
  };
  ws.onopen = () => { let voice = 'builtin'; try { voice = localStorage.voiceLabVoice || 'builtin'; } catch {} ws.send(JSON.stringify({ t: 'hello', secret, proto: 2, voice, turn: currentTurn })); ws.send(JSON.stringify({ t: 'config', turn: currentTurn, values: { voice } })); };
  const rtts = []; setInterval(() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'ping', turn: currentTurn, at: performance.now() })); }, 2000);
  setInterval(() => {
    for (const playback of active.values()) {
      if (!turnState.isCurrent(playback.turn)) continue;
      if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'played', turn: playback.turn, chunk: playback.chunk, ms: Math.max(0, (window.__playedCursor() - playback.startSample) / 24) }));
    }
  }, 100);
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') {
      clearTimeout(thinkTimer); window.__stopTick?.();
      const view = new DataView(event.data);
      const turn = view.getUint32(0, true), index = view.getUint16(4, true), flags = view.getUint16(6, true);
      if (!turnState.accepts(turn)) return;
      const pcm = new Int16Array(event.data, 8);
      const samples = Float32Array.from(pcm, (sample) => sample / 32768);
      const scheduled = window.__playPcm(samples, 24000, turn);
      const key = `${turn}:${index}`;
      currentTurn = turn;
      if (!active.has(key)) active.set(key, { turn, chunk: index, start: scheduled.at, startSample: scheduled.startSample });
      if (firstPlayedTurn !== turn) { firstPlayedTurn = turn; setTimeout(() => { if (turnState.isCurrent(turn) && ws?.readyState === 1) ws.send(JSON.stringify({ t: 'played', turn, chunk: index, ms: 1 })); }, Math.max(0, (scheduled.at - ctx.currentTime) * 1000)); }
      if (!Number.isFinite(window.__firstScheduledTurn) || window.__firstScheduledTurn !== turn) {
        window.__firstScheduledTurn = turn;
        const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
        if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'audio_scheduled', turn, contextTime: scheduled.at, contextNow: ctx.currentTime, output_latency_ms: latency * 1000 }));
      }
      const chunk = chunkTexts.get(key);
      if (chunk && !chunk.emitted) {
        chunk.emitted = true;
        window.__voiceLabListener?.({ type: 'chunk', turn, index, text: chunk.text, startTime: scheduled.at });
      }
      window.__voiceLabListener?.({ type: 'audio', samples, rate: 24000, at: scheduled.at });
      if (flags & 1) {
        const generation = turn;
        setTimeout(() => {
          if (!turnState.isCurrent(generation)) return;
          active.delete(key);
          chunkTexts.delete(key);
          window.__voiceLabListener?.({ type: 'chunkEnd' });
          finishTurnIfReady(turn);
        }, Math.max(0, (scheduled.at + scheduled.duration - ctx.currentTime) * 1000));
      }
      return;
    }
    const message = JSON.parse(event.data);
    if (Number.isInteger(message.turn) && message.t !== "stop" && !turnState.accepts(message.turn)) return;
    if (message.t === 'state') {
      if (message.vad) vadMode = message.vad;
      const labels = { idle: 'Idle', user_speaking: 'Listening', maybe_done: 'Listening', thinking: 'Thinking', speaking: 'Speaking', paused: 'Listening', looking: 'Looking that up' };
      status.textContent = `${vadMode} · ${labels[message.state] || 'Connected'}`;
      $('#light').textContent = labels[message.state] || 'Connected';
      $('#light').dataset.state = message.state;
      clearTimeout(thinkTimer);
      if (message.state === 'thinking') { const generation = currentTurn; thinkTimer = setTimeout(() => { if (turnState.isCurrent(generation)) window.__startTick?.(); }, 900); }
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
    if (message.t === 'nod') { try { const raw = atob(message.pcm), pcm = new Int16Array(raw.length / 2); for (let i = 0; i < pcm.length; i++) pcm[i] = (raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16; const buf = ctx.createBuffer(1, pcm.length, message.rate || 24000); buf.copyToChannel(Float32Array.from(pcm, (v) => v / 32768), 0); const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(); } catch {} return; }
    if (message.t === 'duck') { clearTimeout(localRestoreTimer); localDuckSent = false; window.__duck(); }
    if (message.t === 'pause') { clearTimeout(localRestoreTimer); localDuckSent = false; window.__pause(); }
    if (message.t === 'tool_start') { $('#light').textContent = 'Looking that up'; window.__startTick(); }
    if (message.t === 'tool_end') { $('#toolWait').textContent = (message.ms / 1000).toFixed(2) + ' s'; }
    if (message.t === 'pong') { const rtt = performance.now() - message.at; rtts.push(rtt); if (rtts.length > 8) rtts.shift(); $('#link').textContent = `${rtt.toFixed(0)} ms`; }
    if (message.t === 'tool_start') { $('#light').textContent = 'Looking that up'; window.__startTick(); }
    if (message.t === 'tool_end') { $('#toolWait').textContent = (message.ms / 1000).toFixed(2) + ' s'; }
    if (message.t === 'pong') { const rtt = performance.now() - message.at; rtts.push(rtt); if (rtts.length > 8) rtts.shift(); $('#link').textContent = `${rtt.toFixed(0)} ms`; }
    if (message.t === 'resume') { clearTimeout(localRestoreTimer); localDuckSent = false; window.__stopTick(); window.__resume?.(); }
    if (message.t === 'stop') { if (!turnState.stop(message.turn)) return; clearTimeout(localRestoreTimer); localDuckSent = false; window.__stopPlayback(message.turn); active.clear(); window.__voiceLabListener?.({ type: 'stop', turn: message.turn }); }
    if (message.t === 'timing') {
      turnCount++;
      if (Number.isFinite(message.t_first_audio_scheduled)) {
        playedTimes.push(message.t_first_audio_scheduled);
        if (playedTimes.length > 31) playedTimes.shift();
        const sorted = [...playedTimes].sort((a, b) => a - b);
        message.median_t_first_audio_played = sorted[Math.floor(sorted.length / 2)];
      }
      const sec = (v) => Number.isFinite(v) ? (v / 1000).toFixed(2) + ' s' : '-';
      if (Number.isFinite(message.t_first_audio_scheduled)) { const latency = Number(message.output_latency_ms || 0); $('#firstSound').textContent = (message.t_first_audio_scheduled / 1000).toFixed(2) + ' s at hub + about ' + Math.round(latency) + ' ms to your ear'; $('#median').textContent = sec(message.median_t_first_audio_scheduled) + ' over ' + playedTimes.length + (playedTimes.length === 1 ? ' turn' : ' turns'); }
      $('#tCommit').textContent = sec(message.t_commit); $('#tToken').textContent = sec(message.t_llm_first_token); $('#tVoice').textContent = sec(message.t_voice_first_audio);
      if (Number.isFinite(message.t_tool_start) && Number.isFinite(message.t_tool_end)) $('#toolWait').textContent = ((message.t_tool_end - message.t_tool_start) / 1000).toFixed(2) + ' s';
      if (Number.isFinite(message.t_duck) || Number.isFinite(message.t_stop_sent)) $('#tCut').textContent = sec(message.t_duck) + ' / ' + sec(message.t_stop_sent);
      if (message.ok === false) failedTurns++;
      $('#failedTurns').textContent = `${failedTurns} of ${turnCount}`;
      $('#timings pre').textContent = JSON.stringify(message, null, 2);
    }
    if (message.t === 'warm') { const el = document.querySelector('#warm'); if (el) el.textContent = (el.textContent === '-' ? '' : el.textContent + ', ') + message.part + ' ' + (message.ms / 1000).toFixed(1) + ' s'; }
    if (message.t === 'error') status.textContent = 'The reply could not be completed.';
    if (message.t === 'notice' && message.code === 'voice_not_ready') status.textContent = 'That voice is not ready for this voice engine. Using the built-in voice.';
  };
  node.port.onmessage = (event) => {
    if (ws?.readyState !== 1) return;
    const bytes = event.data;
    if (bytes instanceof ArrayBuffer && bytes.byteLength >= 1036) {
      const view = new DataView(bytes), pcm = new Float32Array(512);
      for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(12 + i * 2, true) / 32768;
      const playing = active.size > 0 && !replyFinished;
      if (localDuckDetector.frame(pcm, { playing, enabled: $('#localDuck').checked }) && !localDuckSent) {
        localDuckSent = true; window.__duck?.(); const turn = currentTurn;
        ws.send(JSON.stringify({ t: 'local_duck', turn }));
        clearTimeout(localRestoreTimer);
        localRestoreTimer = setTimeout(() => { if (turnState.isCurrent(turn) && localDuckSent) { window.__restore?.(); localDuckSent = false; } }, 600);
      }
    }
    ws.send(bytes);
  };
  watchSocket(ws, { make: () => { const n = new WebSocket(ws.url); n.binaryType = 'arraybuffer'; return n; }, status: (t) => { status.textContent = t; }, onSwap: (n) => { ws = n; } });
  $('#start').disabled = true;
  $('#stop').disabled = false;
  $('#output').onchange = () => window.__configureOutput($('#output').value);
  window.__configureOutput($('#output').value);
};
$('#stop').onclick = () => ws?.send(JSON.stringify({ t: 'stop', turn: currentTurn }));
for (const id of ['backchannel', 'silence', 'threshold', 'early', 'echoThreshold', 'output', 'echoSetting', 'talkOver', 'toolDelay', 'netSim', 'localDuck']) {
  $('#' + id).onchange = () => {
    const sim = $('#netSim').value; const values = { backchannel: $('#backchannel').checked, talkOverMode: $('#talkOver').value, toolDelayMs: +$('#toolDelay').value, netSim: sim === 'phone' ? { delayMs: 80, jitterMs: 30, lossPercent: 1, burstEveryMs: 0, burstStallMs: 0 } : sim === 'hotel' ? { delayMs: 200, jitterMs: 120, lossPercent: 3, burstEveryMs: 7000, burstStallMs: 800 } : { delayMs: 0, jitterMs: 0, lossPercent: 0, burstEveryMs: 0, burstStallMs: 0 }, checkSilenceMs: +$('#silence').value, turnThreshold: +$('#threshold').value, earlyStart: $('#early').checked, echoThreshold: +$('#echoThreshold').value, outputPath: $('#output').value, echoSetting: $('#echoSetting').value };
    if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'config', turn: currentTurn, values }));
    if (id === 'output') window.__configureOutput($('#output').value);
    save({ talkOver: $('#talkOver').value, toolDelay: +$('#toolDelay').value, netSim: $('#netSim').value, localDuck: $('#localDuck').checked, output: $('#output').value, echoSetting: $('#echoSetting').value, silenceMs: +$('#silence').value, turnThreshold: +$('#threshold').value, earlyStart: $('#early').checked, echoThreshold: +$('#echoThreshold').value });
  };
}

// Voice choice, voice engine and "record my voice".
const labSecret = () => $('#secret').value || sessionStorage.labSecret || '';
const api = (path, init = {}) => fetch(path, { ...init, headers: { ...(init.headers || {}), 'x-lab-secret': labSecret() } });
const sendVoiceConfig = () => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'config', turn: currentTurn, values: { voice: $('#voice').value, useStyles: $('#useStyles').checked } })); try { localStorage.voiceLabVoice = $('#voice').value; } catch {} };
async function loadVoices() {
  if (!labSecret()) return;
  try {
    const voices = (await (await api('/api/voices')).json()).voices || [];
    let keep = (() => { try { return localStorage.voiceLabVoice; } catch { return ''; } })() || $('#voice').value; if (!keep || keep === 'builtin') keep = 'casual';
    $('#voice').innerHTML = '<option value="builtin">Built-in (slow with this engine)</option>' + voices.map((v) => '<option value="' + v.id + '">' + (v.id === 'me' ? 'My voice' : v.id === 'casual' ? 'Casual sample voice (recommended)' : v.id === 'ref_f' ? 'Sample voice (made up)' : v.id) + (v.styles?.length ? ' (has styled samples)' : '') + '</option>').join('');
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
    try { const r = await api('/api/voices', { method: 'POST', body: form }); const body = await r.json().catch(() => ({})); if (!r.ok || (body.prepared && body.prepared !== 'ok')) throw 0; await loadVoices(); $('#voice').value = 'me'; sendVoiceConfig(); $('#recordStatus').textContent = 'Your voice is ready and selected.'; }
    catch { $('#recordStatus').textContent = 'Your voice could not be made. Record again somewhere quieter, speaking for the full 10 seconds.'; }
  };
};

// Volume during a possible interruption: unchanged by default.
try { if (localStorage.voiceLabDuckLevel) document.querySelector('#duckLevel').value = String(parseFloat(localStorage.voiceLabDuckLevel)); } catch {}
document.querySelector('#duckLevel').addEventListener('change', (e) => window.__setDuckLevel(parseFloat(e.target.value)));
try { document.querySelector('#finishWord').checked = localStorage.voiceLabFinishWord !== '0'; } catch {}
document.querySelector('#finishWord').addEventListener('change', (e) => window.__setFinishWord(e.target.checked));
