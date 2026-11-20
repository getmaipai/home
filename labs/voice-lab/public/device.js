// iPhone Safari support: audio unlock inside the tap, mic constraints, background/lock/route recovery, and the plain-words device check verdict. Pure where possible so tests/device.test.ts can run it without a phone.
export const isIOS = (ua = navigator.userAgent, maxTouch = navigator.maxTouchPoints) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1);
/** Mic constraints. On an iPhone all three processors are on: the phone's own speaker is close to its mic, and without them she hears herself. Elsewhere the page keeps the user's echo setting and the processors off for measuring. */
export function micConstraints(echoSetting, ios) {
  if (ios) return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return { echoCancellation: echoSetting, noiseSuppression: false, autoGainControl: false };
}
/** Must be called synchronously inside the tap handler (before any await): iOS only lets audio start from a user gesture. Resumes the context and plays one silent sample so output is unlocked. */
export function unlockAudio(ctx) {
  let p = Promise.resolve();
  try { if (ctx.state !== 'running') p = ctx.resume(); } catch {}
  try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch {}
  return p;
}
/** Keeps recovery in one place: tab visible again, screen unlocked, headphones or speaker route changed, audio context interrupted. */
export function installLifecycle({ ctx, doc, nav, win, getWs, reconnect, getStream, rebuildMic, report = () => {}, now = () => Date.now(), hiddenReconnectMs = 3000 }) {
  let hiddenAt = 0, micRate = ctx.sampleRate, busy = false;
  const heal = async (why) => {
    if (busy) return; busy = true;
    try {
      let did = [];
      if (ctx.state !== 'running') { try { await ctx.resume(); did.push('audio resumed'); } catch { did.push('audio resume refused'); } }
      const ws = getWs(); const away = hiddenAt ? now() - hiddenAt : 0; hiddenAt = 0;
      if (!ws || ws.readyState > 1 || (ws.readyState === 1 && away >= hiddenReconnectMs)) { reconnect(); did.push('reconnecting'); }
      const tracks = getStream()?.getAudioTracks?.() ?? [];
      if (ctx.sampleRate !== micRate || tracks.length === 0 || tracks.some((t) => t.readyState === 'ended')) { micRate = ctx.sampleRate; try { await rebuildMic(); did.push('microphone rebuilt'); } catch { did.push('microphone rebuild failed'); } }
      report(why, did);
    } finally { busy = false; }
  };
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') hiddenAt = now(); else heal('visible'); });
  win.addEventListener('pageshow', () => heal('pageshow'));
  nav.mediaDevices?.addEventListener?.('devicechange', () => heal('route'));
  ctx.addEventListener?.('statechange', () => { if (ctx.state !== 'running' && doc.visibilityState === 'visible') setTimeout(() => heal('context ' + ctx.state), 400); });
  return { heal };
}
/** Keeps the screen on during a conversation where the browser allows it (iOS 16.4+). Never throws. */
export async function keepScreenOn(nav = navigator) { try { return (await nav.wakeLock?.request?.('screen')) ?? null; } catch { return null; } }
/** The one thing to fix, in plain words, from what the device check measured. null fix = pass. m: {secure, worklet, ctxState, ctxRate, micRate, micLevel, micLevelPeak, echoCancel, ios, toneHeard, roundTripMs} */
export function deviceVerdict(m) {
  if (m.secure === false) return { pass: false, fix: 'Open the page with the https link (the Tailscale one). The microphone does not work on a plain http link.' };
  if (m.worklet === false) return { pass: false, fix: 'This iPhone is too old for the microphone path. It needs iOS 14.5 or newer.' };
  if (m.micError) return { pass: false, fix: 'The microphone is blocked. Open Settings, Safari, Microphone and choose Allow, then reload the page.' };
  if (m.ctxState !== 'running') return { pass: false, fix: 'Audio is not running. Tap the Device check button again (it needs a tap), or turn the ringer on and reload the page.' };
  if (!(m.micLevelPeak > 0.01)) return { pass: false, fix: 'The microphone hears nothing. Say a few words while it records, and check nothing is covering the microphone.' };
  if (m.ios && m.echoCancel === false) return { pass: false, fix: 'The echo canceller is off. Set Browser echo cancelling to true in Settings and run the check again.' };
  if (m.toneHeard === false) return { pass: false, fix: 'The microphone did not hear the test tone. Turn the volume up, flip the Silent switch off, and keep the phone away from a case that covers the speaker.' };
  if (Number.isFinite(m.roundTripMs) && m.roundTripMs > 450) return { pass: false, fix: `Sound takes ${Math.round(m.roundTripMs)} ms to go out and back, which is slow. Disconnect Bluetooth headphones or switch to the phone speaker and run it again.` };
  return { pass: true, fix: null };
}
