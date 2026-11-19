import { chirp, dbfs, doubleTalkDelta, findDelay, measureClip, relativeDb, rms, speechLevel } from './echo-math.js';

const $ = selector => document.querySelector(selector);
const outputs = ['direct', 'element', 'loopback'];
const settings = ['true', 'all', 'false'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const calibration = new Map();

function toFloat32(buffer, rate) {
  const source = buffer.getChannelData(0);
  if (buffer.sampleRate === rate) return new Float32Array(source);
  const result = new Float32Array(Math.round(source.length * rate / buffer.sampleRate));
  for (let i = 0; i < result.length; i++) {
    const position = i * buffer.sampleRate / rate, left = Math.floor(position), fraction = position - left;
    result[i] = (source[left] ?? 0) * (1 - fraction) + (source[left + 1] ?? source[left] ?? 0) * fraction;
  }
  return result;
}

async function play(ctx, buffer, path) {
  const source = ctx.createBufferSource(); source.buffer = buffer;
  let audio, left, right;
  if (path === 'direct') source.connect(ctx.destination);
  else {
    const destination = ctx.createMediaStreamDestination(); source.connect(destination);
    audio = new Audio(); audio.srcObject = destination.stream; audio.autoplay = true;
    if (path === 'element') await audio.play();
    else {
      left = new RTCPeerConnection(); right = new RTCPeerConnection();
      left.onicecandidate = event => event.candidate && right.addIceCandidate(event.candidate);
      right.onicecandidate = event => event.candidate && left.addIceCandidate(event.candidate);
      right.ontrack = event => { audio.srcObject = event.streams[0]; audio.play().catch(() => {}); };
      left.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
      const offer = await left.createOffer(); await left.setLocalDescription(offer); await right.setRemoteDescription(offer);
      const answer = await right.createAnswer(); await right.setLocalDescription(answer); await left.setRemoteDescription(answer);
    }
  }
  const ended = new Promise(resolve => { source.onended = resolve; }); source.start(); await ended;
  if (path !== 'direct') audio.pause();
  left?.close(); right?.close();
}

function recorder(stream, ctx) {
  const source = ctx.createMediaStreamSource(stream), processor = ctx.createScriptProcessor(2048, 1, 1);
  const mute = ctx.createGain(), chunks = []; mute.gain.value = 0;
  source.connect(processor); processor.connect(mute); mute.connect(ctx.destination);
  processor.onaudioprocess = event => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  return { samples: () => { const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0), joined = new Float32Array(length); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; } return joined; }, clear: () => { chunks.length = 0; } };
}

function setStatus(text) { $('#status').textContent = text; }
function format(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }

async function submitRows(secret, rows) {
  await fetch('/api/echo-result', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-secret': secret },
    body: JSON.stringify({ device_label: $('#device').value, user_agent: navigator.userAgent,
      results: rows.map(({ output, echo_setting, leak_db, corr, status }) => ({ output, echo_setting, leak_db, corr, status })) }) });
}

$('#run').addEventListener('click', async () => {
  const secret = $('#secret').value || sessionStorage.labSecret;
  if (!secret) { setStatus('Enter the lab secret.'); return; }
  sessionStorage.labSecret = secret; $('#rows').replaceChildren(); $('#setup').textContent = 'Starting audio…';
  try {
    context ??= new AudioContext(); await context.resume();
    const response = await fetch('/api/echo-clip', { headers: { 'x-lab-secret': secret } });
    if (!response.ok) throw new Error('clip unavailable');
    const clipBuffer = await context.decodeAudioData(await response.arrayBuffer());
    const reference = toFloat32(clipBuffer, context.sampleRate), rows = [], appliedSettings = new Set();
    for (const output of outputs) {
      setStatus(`Checking whether the ${output} output is audible.`);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const track = stream.getAudioTracks()[0], capture = recorder(stream, context), testChirp = chirp(context.sampleRate);
      const chirpBuffer = context.createBuffer(1, testChirp.length, context.sampleRate); chirpBuffer.copyToChannel(testChirp, 0);
      try {
        await sleep(250); capture.clear(); await play(context, chirpBuffer, output); await sleep(200);
        const samples = capture.samples(), found = findDelay(samples, testChirp, context.sampleRate, 0, 1500);
        const heard = Math.abs(found.corr) >= .35;
        calibration.set(output, { delayMs: found.delayMs, chirpLevel: rms(testChirp), rawLevel: rms(samples), heard });
        if (!heard) setStatus(`${output}: output not heard. Check volume and speaker.`);
      } finally { stream.getTracks().forEach(item => item.stop()); }
    }

    for (const output of outputs) for (const setting of settings) {
      const rowElement = document.createElement('tr'); $('#rows').append(rowElement);
      let stream, capture;
      const row = { output, echo_setting: setting, status: 'ok' };
      try {
        if (!calibration.get(output)?.heard) throw new Error('output not heard');
        const echo = setting === 'true' ? true : setting === 'false' ? false : setting;
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: echo, noiseSuppression: false, autoGainControl: false } });
        const track = stream.getAudioTracks()[0]; capture = recorder(stream, context);
        row.applied = JSON.stringify(track.getSettings()); appliedSettings.add(row.applied);
        await sleep(250); capture.clear(); await play(context, clipBuffer, output); await sleep(200);
        const samples = capture.samples(), aligned = measureClip(samples, reference, context.sampleRate, calibration.get(output).delayMs);
        if (!aligned.heard) throw new Error('clip not aligned');
        const base = calibration.get(output);
        const scaledRawLevel = base.rawLevel * rms(reference) / Math.max(base.chirpLevel, 1e-12);
        row.leak_db = relativeDb(aligned.clipLevel, scaledRawLevel);
        row.corr = aligned.corr; row.residual = dbfs(aligned.residualLevel); row.status = 'ok';
        const verdict = row.leak_db > -6 ? 'not cancelled' : row.leak_db > -20 ? 'weak' : 'good'; row.verdict = verdict;
        rowElement.innerHTML = `<td>${output}</td><td>${setting}</td><td>${format(row.leak_db)}</td><td>${format(row.corr, 2)}</td><td>${format(row.residual)} dBFS</td><td>${verdict}</td>`;
        const details = document.createElement('small'); details.textContent = `Applied mic settings: ${row.applied}`; rowElement.lastElementChild.append(details);
      } catch (error) {
        row.status = error.message === 'output not heard' ? 'output not heard' : 'unsupported';
        rowElement.innerHTML = `<td>${output}</td><td>${setting}</td><td></td><td></td><td></td><td>${row.status === 'output not heard' ? 'output not heard: check volume and speaker' : 'not available'}</td>`;
      } finally { stream?.getTracks().forEach(item => item.stop()); }
      rows.push(row);
    }
    const available = rows.filter(row => row.status === 'ok').sort((a, b) => b.leak_db - a.leak_db);
    if (available.length) document.querySelectorAll('#rows tr')[rows.indexOf(available[0])].classList.add('best');
    const setup = `Browser: ${navigator.userAgent}. AudioContext: ${context.sampleRate} Hz; outputLatency ${format(context.outputLatency * 1000)} ms; baseLatency ${format(context.baseLatency * 1000)} ms. Applied mic settings observed: ${[...appliedSettings].join(' / ') || 'unavailable'}.`;
    $('#setup').textContent = setup;
    await submitRows(secret, rows); setStatus('Playback combinations complete. Higher leak dB means more echo returned.');
  } catch (error) { setStatus(error.message === 'clip unavailable' ? 'The speech clip could not be loaded.' : `Audio test stopped: ${error.message}`); }
});

$('#talk').addEventListener('click', async () => {
  const secret = $('#secret').value || sessionStorage.labSecret;
  if (!secret) { setStatus('Enter the lab secret.'); return; }
  try {
    context ??= new AudioContext(); await context.resume();
    const response = await fetch('/api/echo-clip', { headers: { 'x-lab-secret': secret } }); if (!response.ok) throw new Error();
    const buffer = await context.decodeAudioData(await response.arrayBuffer()), ref = toFloat32(buffer, context.sampleRate);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    const output = $('#talk-output').value;
    const capture = recorder(stream, context), delay = calibration.get(output)?.delayMs ?? 0;
    try {
      $('#talk-status').textContent = 'Read: “The quick brown fox jumps over the lazy dog.”';
      await sleep(4000); const a = capture.samples(); capture.clear();
      $('#talk-status').textContent = 'Now read the same sentence while the clip plays.';
      const playback = play(context, buffer, output); await playback;
      const b = capture.samples(), levelA = rms(a), levelB = speechLevel(b, ref, context.sampleRate, delay);
      $('#talk-status').textContent = `Speech level change: ${format(doubleTalkDelta(levelA, levelB))} dB (level A ${format(dbfs(levelA))} dBFS, level B ${format(dbfs(levelB))} dBFS).`;
    } finally { stream.getTracks().forEach(track => track.stop()); }
  } catch { $('#talk-status').textContent = 'Double-talk test could not start. Check microphone permission.'; }
});
