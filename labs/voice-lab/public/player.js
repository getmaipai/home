import { PlaybackBuffer } from './playback-buffer.js';

const ctx = new AudioContext();
const gain = ctx.createGain();
const buffer = new PlaybackBuffer();
let paths = {}, destination = ctx.destination, output = 'direct';
let paused = false, ducked = false, next = ctx.currentTime, tickTimer = 0;
let scheduled = [], playedCursor = 0, activeTurn = 0, sampleRate = 24000;
let jitterMs = 120, underruns = 0;
const audio = document.querySelector('#audio');

function pathNode(mode) {
  if (!paths[mode]) {
    if (mode === 'element') {
      const dest = ctx.createMediaStreamDestination();
      paths.element = { node: dest, stream: dest.stream };
    } else if (mode === 'loopback') {
      const dest = ctx.createMediaStreamDestination();
      const a = new RTCPeerConnection(), b = new RTCPeerConnection();
      a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
      b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
      b.ontrack = (e) => { audio.srcObject = e.streams[0]; };
      a.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
      a.createOffer().then((offer) => a.setLocalDescription(offer).then(() => b.setRemoteDescription(offer)))
        .then(() => b.createAnswer()).then((answer) => b.setLocalDescription(answer).then(() => a.setRemoteDescription(answer)));
      paths.loopback = { node: dest };
    }
  }
  gain.disconnect();
  if (mode === 'direct') destination = ctx.destination;
  else { destination = paths[mode].node; if (mode === 'element') audio.srcObject = paths[mode].stream; }
  gain.connect(destination);
}

function configureOutput(value) { output = value; pathNode(value); }
function ramp(value, duration = .015) {
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(value, ctx.currentTime + duration);
}
function scheduleSlice() {
  if (paused || buffer.cursor >= buffer.length) return;
  const count = Math.min(Math.round(sampleRate * .1), buffer.length - buffer.cursor);
  const startCursor = buffer.cursor;
  const samples = buffer.read(count);
  if (!samples.length) return;
  const audioBuffer = ctx.createBuffer(1, samples.length, sampleRate);
  audioBuffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer; source.connect(gain);
  const at = Math.max(next, ctx.currentTime + .01);
  source.start(at); next = at + audioBuffer.duration;
  scheduled.push({ source, at, end: next, startCursor, endCursor: startCursor + samples.length });
}
function playedPosition() {
  const current = ctx.currentTime;
  const partial = scheduled.find((item) => item.at <= current && item.end > current);
  return partial ? partial.startCursor + Math.min(partial.endCursor - partial.startCursor, Math.floor((current - partial.at) * sampleRate)) : playedCursor;
}
function pump() {
  if (paused) return;
  while (next < ctx.currentTime + .1 && buffer.cursor < buffer.length) scheduleSlice();
  const done = scheduled.filter((item) => item.end <= ctx.currentTime);
  if (done.length) playedCursor = Math.max(playedCursor, done.at(-1).endCursor);
  scheduled = scheduled.filter((item) => item.end > ctx.currentTime);
}
function playPcm(samples, rate = 24000, turn = activeTurn) {
  if (turn !== activeTurn) { buffer.stop(); scheduled = []; activeTurn = turn; next = ctx.currentTime + .01; playedCursor = 0; ducked = false; ramp(1); }
  if (!buffer.length) sampleRate = rate;
  const startSample = buffer.length;
  buffer.append(samples);
  pump();
  return { at: scheduled.find((item) => item.startCursor === startSample)?.at ?? Math.max(ctx.currentTime, next), duration: samples.length / rate, startSample };
}
function stopPlayback(turn) {
  if (Number.isInteger(turn) && turn < activeTurn) return;
  ramp(0);
  const stoppedTurn = Number.isInteger(turn) ? turn : activeTurn;
  setTimeout(() => {
    if (activeTurn !== stoppedTurn) return;
    for (const item of scheduled) try { item.source.stop(); } catch {}
    scheduled = []; buffer.stop(); paused = false; ducked = false; next = ctx.currentTime; playedCursor = 0; activeTurn = stoppedTurn;
    ramp(1); stopTick();
  }, 15);
}
function duck() { ducked = true; buffer.duck(); ramp(.3); }
function restore() { ducked = false; buffer.restore(); ramp(1); }
function pause() {
  if (paused) return;
  pump(); paused = true;
  const current = ctx.currentTime;
  const stopAt = current + .015;
  const heard = scheduled.filter((item) => item.end <= stopAt).at(-1);
  const partial = scheduled.find((item) => item.at <= stopAt && item.end > stopAt);
  const exact = partial ? partial.startCursor + Math.floor((stopAt - partial.at) * sampleRate) : heard?.endCursor ?? playedCursor;
  buffer.cursor = Math.min(buffer.cursor, exact);
  buffer.pause(); ramp(0, .015);
  for (const item of scheduled) try { item.source.stop(current + .015); } catch {}
  scheduled = []; next = current + .015;
}
function resume() {
  if (paused) {
    const atChunk = null;
    buffer.resume(sampleRate, atChunk);
    paused = false; ducked = false; buffer.restore(); next = ctx.currentTime + .015; ramp(1);
    pump();
  } else restore();
}
function startTick() {
  stopTick();
  tickTimer = setInterval(() => {
    if (paused || buffer.length > buffer.cursor) return;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = 880; g.gain.value = .018; osc.connect(g); g.connect(gain); osc.start(); osc.stop(ctx.currentTime + .035);
  }, 600);
}
function stopTick() { clearInterval(tickTimer); tickTimer = 0; }
setInterval(pump, 20);
window.voiceLab = { onSpeech(listener) { window.__voiceLabListener = listener; } };
window.__voiceCtx = ctx;
window.__playPcm = playPcm;
window.__stopPlayback = stopPlayback;
window.__duck = duck;
window.__restore = restore;
window.__resume = resume;
window.__pause = pause;
window.__configureOutput = configureOutput;
window.__startTick = startTick;
window.__stopTick = stopTick;
window.__playedCursor = playedPosition;
