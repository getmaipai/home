import { mkdir, writeFile } from "node:fs/promises";
import { parseWav } from "./ttsProofMetrics";
import { TTS_PROOF_LINES } from "./tts-proof-lines";

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
  console.error("The benchmark is historical: Home's local speech recognizer was removed by HOME-DEL-STT.");
  process.exitCode = 2;
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
