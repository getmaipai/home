import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { parseWav, clipFraction, edgeSilence, voicedSeconds, compareLine, buildControlRow, renderTable, type LineMetrics, type ProofRow } from "./ttsProofMetrics";
import { TTS_PROOF_LINES } from "./tts-proof-lines";

interface Args { homePort: number; stackUrl: string; voice: string; lines: number; out: string; spawnHome: boolean; control?: "home" | "stack"; keepAudio?: string }
export function parseArgs(argv: string[]): Args {
  const args: Args = { homePort: 8795, stackUrl: "http://127.0.0.1:8770", voice: "alba", lines: 30, out: "./tts-stack16-d-results.json", spawnHome: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === "--spawn-home") { args.spawnHome = true; continue; }
    if (flag === "--control") { const value = argv[++i]; if (value !== "home" && value !== "stack") throw new Error("--control must be home or stack"); args.control = value; continue; }
    if (!["--home-port", "--stack-url", "--voice", "--lines", "--out", "--keep-audio"].includes(flag)) throw new Error(`Unknown flag: ${flag}`);
    const value = argv[++i];
    if (!value) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case "--home-port": args.homePort = positive(value, flag); break;
      case "--stack-url": args.stackUrl = value; break;
      case "--voice": args.voice = value; break;
      case "--lines": args.lines = positive(value, flag); if (args.lines > 30) throw new Error("--lines must be at most 30"); break;
      case "--out": args.out = value; break;
      case "--keep-audio": args.keepAudio = value; break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}
function positive(value: string, flag: string): number { const number = Number(value); if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(`Invalid value for ${flag}`); return number; }

async function capture(url: string, text: string, voice: string, side: string, keepAudio?: string): Promise<{ metrics: LineMetrics; bytes: Uint8Array; headers: Record<string, string> }> {
  const form = new FormData(); form.append("text", text); form.append("voice_url", voice);
  if (side === "stack") form.append("model", "tts");
  const started = performance.now();
  const response = await fetch(url, { method: "POST", body: form });
  if (!response.ok || !response.body) throw new Error(`${side} speech request failed with ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let firstAudioMs: number | undefined;
  let all = new Uint8Array();
  let dataOffset = 44;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
    const merged = new Uint8Array(size); let at = 0; for (const chunk of chunks) { merged.set(chunk, at); at += chunk.length; }
    all = merged;
    if (firstAudioMs === undefined && size > dataOffset) {
      try { dataOffset = parseWav(all).dataOffset; } catch { /* header is incomplete */ }
      if (size > dataOffset) firstAudioMs = performance.now() - started;
    }
  }
  if (firstAudioMs === undefined) throw new Error(`${side} returned no audio samples`);
  const wav = parseWav(all);
  const edges = edgeSilence(wav.samples, wav.sampleRate);
  if (keepAudio) { await mkdir(keepAudio, { recursive: true }); await writeFile(`${keepAudio}/${side}-${crypto.randomUUID()}.wav`, all); }
  const headers = Object.fromEntries([...response.headers.entries()].filter(([key]) => key.startsWith("x-stack-") || key.startsWith("x-maipai-")));
  return { bytes: all, headers, metrics: { durationSeconds: wav.durationSeconds, voicedSeconds: voicedSeconds(wav.durationSeconds, edges.leadingSeconds, edges.trailingSeconds), sampleRate: wav.sampleRate, channels: wav.channels, clipFraction: clipFraction(wav.samples), ...edges, firstAudioMs } };
}

async function ready(url: string): Promise<boolean> { try { const response = await fetch(url); return response.ok; } catch { return false; } }
async function waitHealthy(url: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) { if (process.exitCode !== null) throw new Error("Home Pocket TTS exited before becoming healthy"); if (await ready(`${url}/health`)) return; await Bun.sleep(1_000); }
  throw new Error("Home Pocket TTS did not become healthy within 10 minutes");
}
function stopChild(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.killed) return Promise.resolve();
  return new Promise((resolve) => { process.once("exit", () => resolve()); process.kill("SIGTERM"); setTimeout(() => { if (process.exitCode === null) process.kill("SIGKILL"); }, 5_000).unref(); });
}
function versionFrom(text: string): string { return text.trim() || "unknown"; }

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const base = args.stackUrl.replace(/\/$/, "");
  let tts: Record<string, unknown> | undefined;
  if (args.control !== "home") {
    const roleResponse = await fetch(`${base}/stack/v1/roles`);
    if (!roleResponse.ok) throw new Error(`Stack roles preflight failed: ${roleResponse.status}`);
    const roles = await roleResponse.json() as { roles?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const rows = Array.isArray(roles) ? roles : roles.roles ?? [];
    tts = rows.find((row) => row.id === "tts");
    const state = (tts?.state as { state?: string } | undefined)?.state;
    if (!tts || state === "notInstalled" || !state) { console.error("The Stack's text to speech is not installed."); process.exitCode = 2; return; }
  }
  const pressure = await Bun.$`memory_pressure`.text();
  const match = pressure.match(/System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/i);
  if (!match) throw new Error("Could not parse System-wide memory free percentage from memory_pressure");
  const freePercent = Number(match[1]);
  if (freePercent < 25) { console.error(`Free memory is ${freePercent} percent; need at least 25 percent.`); process.exitCode = 3; return; }

  let homeChild: ChildProcess | undefined;
  const homeBase = `http://127.0.0.1:${args.homePort}`;
  try {
    if (args.spawnHome) {
      homeChild = spawn("uvx", ["pocket-tts", "serve", "--port", String(args.homePort), "--host", "127.0.0.1"], { env: { ...process.env }, stdio: "ignore" });
      await waitHealthy(homeBase, homeChild);
    }
    const stackSpeech = `${base}/v1/audio/speech`;
    if (args.control === "home") await capture(`${homeBase}/tts`, "Warm up the voice.", args.voice, "home", args.keepAudio);
    else if (args.control === "stack") await capture(stackSpeech, "Warm up the voice.", args.voice, "stack", args.keepAudio);
    else {
      await capture(`${homeBase}/tts`, "Warm up the voice.", args.voice, "home", args.keepAudio);
      await capture(stackSpeech, "Warm up the voice.", args.voice, "stack", args.keepAudio);
    }
    const results: ProofRow[] = [];
    for (const [index, text] of TTS_PROOF_LINES.slice(0, args.lines).entries()) {
      let home: Awaited<ReturnType<typeof capture>>; let stack: Awaited<ReturnType<typeof capture>>;
      if (args.control === "home") {
        home = await capture(`${homeBase}/tts`, text, args.voice, "home", args.keepAudio);
        stack = await capture(`${homeBase}/tts`, text, args.voice, "home", args.keepAudio);
      } else if (args.control === "stack") {
        home = await capture(stackSpeech, text, args.voice, "stack", args.keepAudio);
        stack = await capture(stackSpeech, text, args.voice, "stack", args.keepAudio);
      } else {
        home = await capture(`${homeBase}/tts`, text, args.voice, "home", args.keepAudio);
        stack = await capture(stackSpeech, text, args.voice, "stack", args.keepAudio);
      }
      const row = args.control ? buildControlRow(index + 1, text, home.metrics, stack.metrics) : { line: index + 1, text, home: home.metrics, stack: stack.metrics, comparison: compareLine(home.metrics, stack.metrics) };
      results.push(row);
      console.log(`line ${index + 1} Home headers: ${JSON.stringify(home.headers)} Stack headers: ${JSON.stringify(stack.headers)}`);
    }
    let stackVersion: unknown = "unknown"; let stackTtsVersion: unknown = "unknown";
    if (args.control !== "home") {
      try { const health = await (await fetch(`${base}/healthz`)).json() as Record<string, unknown>; stackVersion = health.version ?? "unknown"; } catch { /* reported as unknown */ }
      const roleState = tts!;
      stackTtsVersion = roleState.engineVersion ?? roleState.version ?? "unknown";
    }
    let homeVersion = "unknown";
    try { homeVersion = versionFrom((await Bun.$`uvx --offline pocket-tts --version`.text())); } catch { /* no network attempt */ }
    const output = { control: args.control ? `${args.control} against itself` : null, versions: { stack: stackVersion, stackPocketTts: stackTtsVersion, homePocketTts: homeVersion }, hardware: { arch: arch(), cpu: cpus()[0]?.model ?? "unknown", totalMemoryGb: Number((totalmem() / 1e9).toFixed(2)) }, rows: results };
    await writeFile(args.out, JSON.stringify(output, null, 2));
    console.log(args.control ? `control: ${args.control} against itself` : "comparison: Home against Stack");
    console.log(renderTable(results));
    const passed = results.every((row) => Object.values(row.comparison).filter((value) => typeof value === "boolean").every(Boolean));
    process.exitCode = passed ? 0 : 1;
  } finally { if (homeChild) await stopChild(homeChild); }
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
