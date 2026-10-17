// The /mic-test runner: each microphone step on its own, in the order the
// real capture does them, so a Safari report says exactly which one fails.
// Started from one button click; the first two steps begin synchronously
// in that click (Safari's user-activation rule).
import { StreamResampler } from "@/lib/voice/resampler";
import { createAudioContext, loadMicWorklet, micWorkletUrl, openMicStream, WORKLET_NAME, withTimeout } from "@/lib/voice/mic-capture";
import { errMessage, errName, micEnvironmentLines } from "@/lib/voice/micDiagnostics";

export type MicTestStatus = "pass" | "fail" | "skip";
export interface MicTestResult {
  id: string;
  label: string;
  status: MicTestStatus;
  detail: string;
}

type Report = (result: MicTestResult) => void;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function step(report: Report, id: string, label: string, run: () => Promise<string | undefined>): Promise<boolean> {
  try {
    const detail = await run();
    report({ id, label, status: "pass", detail: detail ?? "" });
    return true;
  } catch (err) {
    report({ id, label, status: "fail", detail: `${errName(err)}: ${errMessage(err)}` });
    return false;
  }
}
const skip = (report: Report, id: string, label: string, why: string) => report({ id, label, status: "skip", detail: why });

function stopStream(stream: MediaStream | undefined) {
  stream?.getTracks().forEach((track) => { try { track.stop(); } catch { /* ignore */ } });
}

/** Level meter over `seconds`, returning the peak 0..1 reading. */
async function peakLevel(context: AudioContext, source: AudioNode, seconds: number, onTick?: (peak: number) => void): Promise<number> {
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let peak = 0;
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    analyser.getByteTimeDomainData(data);
    let max = 0;
    for (const v of data) max = Math.max(max, Math.abs(v - 128) / 128);
    peak = Math.max(peak, max);
    onTick?.(peak);
    await wait(100);
  }
  try { analyser.disconnect(); } catch { /* ignore */ }
  return peak;
}

/** Call from a click handler. Reports each step as it finishes. */
export async function runMicTest(report: Report, onMeter?: (peak: number) => void): Promise<void> {
  // Synchronous part of the tap: request the microphone and start an audio context now.
  let streamPromise: Promise<MediaStream> | undefined;
  let streamStartError: unknown;
  try { streamPromise = navigator.mediaDevices.getUserMedia({ audio: true }); } catch (err) { streamStartError = err; }
  streamPromise?.catch(() => {});
  let context: AudioContext | undefined;
  let contextError: unknown;
  try { context = createAudioContext(); void context.resume().catch(() => {}); } catch (err) { contextError = err; }

  await step(report, "env", "Browser and page", async () => {
    const parts = [...micEnvironmentLines()];
    parts.push(
      `mediaDevices: ${String(Boolean(navigator.mediaDevices?.getUserMedia))}`,
      `AudioContext: ${String(typeof AudioContext !== "undefined")}, webkitAudioContext: ${String(typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined")}`,
      `AudioWorklet: ${String(typeof AudioWorkletNode !== "undefined")}`,
    );
    if (!window.isSecureContext) throw new Error(`not a secure context. ${parts.join(" | ")}`);
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(`navigator.mediaDevices.getUserMedia is missing. ${parts.join(" | ")}`);
    return parts.join("\n");
  });

  await step(report, "permission", "Permission query", async () => {
    if (!navigator.permissions?.query) return "Permissions API not available (normal in Safari). Skipped.";
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return `state: ${status.state}`;
  });

  let stream: MediaStream | undefined;
  await step(report, "gum-plain", "getUserMedia, plain audio", async () => {
    if (streamStartError) throw streamStartError;
    stream = await streamPromise!;
    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings?.() ?? {};
    return `track: ${track?.label ?? "none"}, readyState ${track?.readyState}, muted ${String(track?.muted)}, sampleRate ${settings.sampleRate ?? "unknown"}`;
  });

  await step(report, "audio-context", "AudioContext, create", async () => {
    if (contextError || !context) throw contextError ?? new Error("no AudioContext");
    return `created with defaults, sampleRate ${context.sampleRate}, state ${context.state}`;
  });

  await step(report, "audio-resume", "AudioContext, resume", async () => {
    if (!context) throw new Error("no AudioContext");
    if (context.state !== "running") {
      const outcome = await withTimeout(context.resume(), 2000);
      if (outcome === "timeout") throw new Error(`resume() did not finish in 2 s, state ${context.state}`);
    }
    if (context.state !== "running") throw new Error(`state is ${context.state}, not running`);
    return "state running";
  });

  await step(report, "gum-home", "getUserMedia, Home settings", async () => {
    stopStream(stream);
    stream = await openMicStream();
    return "opened with the same constraints Conversation uses";
  });

  let source: MediaStreamAudioSourceNode | undefined;
  await step(report, "source", "Microphone into audio graph", async () => {
    if (!context || !stream) throw new Error("needs the AudioContext and microphone above");
    source = context.createMediaStreamSource(stream);
    return "createMediaStreamSource ok";
  });

  await step(report, "worklet-file", "Worklet file fetch", async () => {
    const url = micWorkletUrl();
    const response = await fetch(url, { cache: "no-store" });
    const text = await response.text();
    const type = response.headers.get("content-type") ?? "none";
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    if (/^\s*</.test(text)) throw new Error(`${url} returned a web page (${type}), not the worklet script`);
    if (!text.includes(WORKLET_NAME)) throw new Error(`${url} (${type}) is not the worklet script`);
    return `${url}: ${response.status}, ${type}, ${text.length} bytes`;
  });

  const frames = { worklet: 0, processor: 0 };
  let workletNode: AudioWorkletNode | undefined;
  await step(report, "worklet", "AudioWorklet addModule and node", async () => {
    if (!context || !source) throw new Error("needs the audio graph above");
    await loadMicWorklet(context);
    workletNode = new AudioWorkletNode(context, WORKLET_NAME, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit" });
    const silent = context.createGain();
    silent.gain.value = 0;
    workletNode.port.onmessage = () => { frames.worklet++; };
    source.connect(workletNode);
    workletNode.connect(silent);
    silent.connect(context.destination);
    await wait(1000);
    if (frames.worklet === 0) throw new Error("loaded, but no audio blocks arrived in 1 s");
    return `${frames.worklet} blocks in 1 s`;
  });
  await step(report, "script-processor", "ScriptProcessor (fallback)", async () => {
    if (!context || !source) throw new Error("needs the audio graph above");
    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = () => { frames.processor++; };
    source.connect(processor);
    processor.connect(context.destination);
    await wait(1500);
    try { processor.disconnect(); processor.onaudioprocess = null; } catch { /* ignore */ }
    if (frames.processor === 0) throw new Error("created, but no audio blocks arrived in 1.5 s");
    return `${frames.processor} blocks in 1.5 s`;
  });

  await step(report, "resampler", "Resample to 16 kHz", async () => {
    const rate = context?.sampleRate ?? 48_000;
    const resampler = new StreamResampler(rate, 16_000);
    const input = new Float32Array(rate / 10).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / rate));
    const out = resampler.process(input);
    const expected = 1600;
    if (Math.abs(out.length - expected) > 2) throw new Error(`${rate} Hz in gave ${out.length} samples, expected about ${expected}`);
    return `${rate} Hz to 16000 Hz: ${input.length} in, ${out.length} out`;
  });

  if (context && source) {
    const ctx = context;
    const src = source;
    await step(report, "meter", "Level meter, 3 seconds (speak now)", async () => {
      const track = stream?.getAudioTracks()[0];
      const peak = await peakLevel(ctx, src, 3, onMeter);
      const state = `track readyState ${track?.readyState}, muted ${String(track?.muted)}`;
      if (track?.readyState === "ended") throw new Error(`the microphone track ended. ${state}`);
      if (peak === 0) throw new Error(`no signal heard (flat zero). ${state}`);
      return `peak ${(peak * 100).toFixed(0)} percent. ${state}`;
    });
  } else {
    skip(report, "meter", "Level meter, 3 seconds", "needs the audio graph above");
  }

  try { workletNode?.disconnect(); } catch { /* ignore */ }
  try { source?.disconnect(); } catch { /* ignore */ }
  stopStream(stream);
  void context?.close().catch(() => {});
}

export function micTestText(results: MicTestResult[]): string {
  return ["MaiPai Home microphone test", ...micEnvironmentLines(), ...results.map((r) => `${r.status.toUpperCase()}  ${r.label}${r.detail ? `: ${r.detail.replace(/\n/g, " | ")}` : ""}`)].join("\n");
}
