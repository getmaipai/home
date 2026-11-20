// One-tap device check: mic level, output tone, round-trip delay, sample rate, echo canceller state; shows PASS or the one thing to fix, and posts the numbers to the lab log.
import { rms, chirp, findDelay } from "./echo-math.js";
import { isIOS, micConstraints, unlockAudio, deviceVerdict } from "./device.js";
export function postDeviceReport(secret, body) { try { return fetch('/api/device-report', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-secret': secret || '' }, body: JSON.stringify(body), keepalive: true }).catch(() => {}); } catch { return Promise.resolve(); } }
function record(ctx, stream, ms) {
  return new Promise((resolve) => {
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(2048, 1, 1), mute = ctx.createGain(); mute.gain.value = 0; const chunks = [];
    src.connect(proc); proc.connect(mute); mute.connect(ctx.destination); proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    setTimeout(() => { proc.disconnect(); src.disconnect(); mute.disconnect(); const n = chunks.reduce((s, c) => s + c.length, 0), out = new Float32Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } resolve(out); }, ms);
  });
}
export async function runDeviceCheck({ ctx, secret, ws, el, echoSetting }) {
  const ios = isIOS(), m = { ios, secure: window.isSecureContext, worklet: !!ctx.audioWorklet, ctxRate: ctx.sampleRate }; el.textContent = 'Checking. Say a few words now...';
  await unlockAudio(ctx); m.ctxState = ctx.state; m.outputLatencyMs = Math.round((ctx.outputLatency || 0) * 1000); m.baseLatencyMs = Math.round((ctx.baseLatency || 0) * 1000);
  if (ws()?.readyState === 1) { el.textContent = 'Press Stop first (the check needs the microphone to itself), then run it again.'; return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(echoSetting === 'false' ? false : true, ios) }); } catch (e) { m.micError = String(e?.name || e); }
  if (stream) {
    const s = stream.getAudioTracks()[0].getSettings(); m.micRate = s.sampleRate; m.echoCancel = s.echoCancellation; m.noiseSuppression = s.noiseSuppression; m.autoGain = s.autoGainControl;
    const heard = await record(ctx, stream, 1800); const f = 1024; let peak = 0; for (let i = 0; i + f < heard.length; i += f) peak = Math.max(peak, rms(heard.subarray(i, i + f))); m.micLevel = +rms(heard).toFixed(4); m.micLevelPeak = +peak.toFixed(4);
    stream.getTracks().forEach((t) => t.stop());
    // output tone and round trip: with the canceller OFF (otherwise it removes our own tone), play a chirp and find it in the microphone
    try {
      const raw = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ref = chirp(ctx.sampleRate, 0.5), buf = ctx.createBuffer(1, ref.length, ctx.sampleRate); buf.copyToChannel(ref, 0);
      const rec = record(ctx, raw, 2200); await new Promise((r) => setTimeout(r, 300)); const t0 = ctx.currentTime, srcNode = ctx.createBufferSource(); srcNode.buffer = buf; srcNode.connect(ctx.destination); srcNode.start(); const samples = await rec; raw.getTracks().forEach((t) => t.stop());
      const hit = findDelay(samples, ref, ctx.sampleRate, 300, 1200); m.toneHeard = Math.abs(hit.corr) > 0.02; m.roundTripMs = m.toneHeard ? Math.round(hit.delayMs - 300) : NaN; void t0;
    } catch { m.toneHeard = undefined; }
  }
  const v = deviceVerdict(m); el.textContent = (v.pass ? 'PASS. ' : 'FIX: ') + (v.fix ?? `Microphone, speaker and echo canceller look fine (${m.ctxRate} Hz, round trip about ${m.roundTripMs} ms).`);
  postDeviceReport(secret, { event: 'device_check', pass: v.pass, fix: v.fix, ...Object.fromEntries(Object.entries(m).filter(([, x]) => ['number', 'boolean', 'string'].includes(typeof x))) });
}
