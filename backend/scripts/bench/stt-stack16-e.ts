import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { parseWav } from "./ttsProofMetrics";
import { TTS_PROOF_LINES } from "./tts-proof-lines";
import { normalizeText, resampleLinear, renderSttTable, summarizeStt, wordErrorRate, compareStt, type SttRow } from "./sttProofMetrics";
import { encodeWav } from "@/lib/sttSession";
import { transcribe, sttAssetsInstalled } from "@/lib/stt";

interface Args { stackUrl: string; voice: string; lines: number; out: string; keepAudio?: string }
export function parseArgs(argv: string[]): Args {
  const args: Args = { stackUrl: "http://127.0.0.1:8770", voice: "alba", lines: 30, out: "./stt-stack16-e-results.json" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (!["--stack-url", "--voice", "--lines", "--out", "--keep-audio"].includes(flag)) throw new Error(`Unknown flag: ${flag}`);
    const value = argv[++i]; if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--stack-url") args.stackUrl = value;
    else if (flag === "--voice") args.voice = value;
    else if (flag === "--out") args.out = value;
    else if (flag === "--keep-audio") args.keepAudio = value;
    else { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 30) throw new Error("--lines must be from 1 to 30"); args.lines = n; }
  }
  return args;
}

async function stackTranscribe(base: string, wav: Uint8Array): Promise<string> {
  const form = new FormData(); form.append("file", new File([wav], "utterance.wav", { type: "audio/wav" })); form.append("model", "stt");
  const response = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Stack transcription failed with ${response.status}`);
  return (await response.json() as { text: string }).text;
}
async function render(base: string, text: string, voice: string): Promise<Uint8Array> {
  const form = new FormData(); form.append("text", text); form.append("voice_url", voice); form.append("model", "tts");
  const response = await fetch(`${base}/v1/audio/speech`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Stack speech request failed with ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2)); const base = args.stackUrl.replace(/\/$/, "");
  const pressure = await Bun.$`memory_pressure`.text(); const match = pressure.match(/System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/i);
  if (!match) throw new Error("Could not parse System-wide memory free percentage from memory_pressure");
  const freePercent = Number(match[1]); if (freePercent < 35) { console.error(`Free memory is ${freePercent} percent; need at least 35 percent.`); process.exitCode = 3; return; }
  let roleRows: Record<string, unknown>[] = [];
  try { const response = await fetch(`${base}/stack/v1/roles`); if (!response.ok) throw new Error(`Stack roles preflight failed: ${response.status}`); const payload = await response.json() as { roles?: Record<string, unknown>[] } | Record<string, unknown>[]; roleRows = Array.isArray(payload) ? payload : payload.roles ?? []; }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; return; }
  for (const id of ["tts", "stt"]) { const role = roleRows.find((item) => item.id === id); const stateValue = role?.state; const state = typeof stateValue === "string" ? stateValue : (stateValue as { state?: string } | undefined)?.state; if (!role || state === "notInstalled") { console.error(`The Stack's ${id === "tts" ? "text to speech" : "speech to text"} is not installed. Install it first.`); process.exitCode = 2; return; } }
  if (!sttAssetsInstalled()) { console.error("Home's speech assets are not installed; nothing is downloaded by this script."); process.exitCode = 2; return; }

  let ttsUnloadAttempted = false;
  const clips: { reference: string; samples: Float32Array; wav: Uint8Array }[] = [];
  try {
    for (const [index, reference] of TTS_PROOF_LINES.slice(0, args.lines).entries()) {
      const wav = await render(base, reference, args.voice); const parsed = parseWav(wav);
      if (parsed.channels !== 1) throw new Error(`Stack TTS returned ${parsed.channels} channels; mono audio is required`);
      const samples = resampleLinear(parsed.samples, parsed.sampleRate, 16_000);
      const stackWav = encodeWav(samples, 16_000);
      clips.push({ reference, samples, wav: stackWav });
      if (args.keepAudio) { await mkdir(args.keepAudio, { recursive: true }); await writeFile(`${args.keepAudio}/line-${index + 1}.wav`, wav); }
    }
    // Warm up both sides once. These requests are excluded from scoring.
    await transcribe(clips[0]!.samples, 16_000); await stackTranscribe(base, clips[0]!.wav);
    const rows: SttRow[] = []; let deterministic = true; const pairs: Array<{ home: boolean; stack: boolean }> = [];
    for (const [index, clip] of clips.entries()) {
      const homeStart = performance.now(); const homeText = await transcribe(clip.samples, 16_000); const homeMs = performance.now() - homeStart;
      const stackStart = performance.now(); const stackText = await stackTranscribe(base, clip.wav); const stackMs = performance.now() - stackStart;
      if (index < 5) {
        const homeAgain = await transcribe(clip.samples, 16_000); const stackAgain = await stackTranscribe(base, clip.wav);
        const pair = { home: normalizeText(homeText) === normalizeText(homeAgain), stack: normalizeText(stackText) === normalizeText(stackAgain) };
        pairs.push(pair); deterministic &&= pair.home && pair.stack;
      }
      const homeScore = wordErrorRate(normalizeText(clip.reference), normalizeText(homeText)); const stackScore = wordErrorRate(normalizeText(clip.reference), normalizeText(stackText));
      const home = { text: homeText, wer: homeScore.wer, errors: homeScore.errors, ms: homeMs }; const stack = { text: stackText, wer: stackScore.wer, errors: stackScore.errors, ms: stackMs };
      rows.push({ line: index + 1, reference: clip.reference, referenceWords: homeScore.referenceWords, home, stack, comparison: compareStt(home, stack) });
    }
    const summary = summarizeStt(rows, deterministic);
    const roleStates = Object.fromEntries(["stt", "tts"].map((id) => { const row = roleRows.find((item) => item.id === id)!; return [id, { state: row.state, modelId: row.modelId ?? row.model_id ?? row.model ?? null }]; }));
    const output = { deterministicPairs: pairs, summary, roles: roleStates, hardware: { arch: arch(), cpu: cpus()[0]?.model ?? "unknown", totalMemoryGb: Number((totalmem() / 1e9).toFixed(2)) }, rows };
    await writeFile(args.out, JSON.stringify(output, null, 2)); console.log(renderSttTable(rows, summary)); process.exitCode = summary.passed ? 0 : 1;
  } finally {
    if (clips.length) { ttsUnloadAttempted = true; try { await fetch(`${base}/stack/v1/models/pocket-tts-english/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unload" }) }); } catch { /* unload report below remains truthful about attempt */ } }
    if (ttsUnloadAttempted) console.log("Stack TTS model unload requested to free memory.");
  }
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
