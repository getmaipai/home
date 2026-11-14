// Home invokes the separately installed MIT helper; no signature implementation is bundled here.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stackDataDir } from "@/lib/localStackService";

export type Signature = { uri: string; sampleMs: number };

const SCRIPT = `import asyncio,sys,json
from shazamio_core import Recognizer
async def m():
 s=await Recognizer(segment_duration_seconds=10).recognize_bytes(sys.stdin.buffer.read())
 print(json.dumps({'uri':s.signature.uri,'ms':s.signature.samples}))
asyncio.run(m())`;

export function findShazamPython(stackData?: string): string | null {
  const override = process.env.MAIPAI_SHAZAM_PYTHON;
  if (override) return existsSync(override) ? override : null;
  try {
    const root = join(stackData ?? stackDataDir(), "engines", "shazam-signature");
    for (const version of readdirSync(root).sort().reverse()) {
      const versionDir = join(root, version);
      const candidate = join(versionDir, "venv", "bin", "python");
      if (existsSync(candidate) && existsSync(join(versionDir, ".env-ready"))) return candidate;
    }
  } catch { /* Stack helper is not installed */ }
  return null;
}

export function wavOf(pcm: Int16Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(out.buffer);
  const ascii = (at: number, value: string) => { for (let i = 0; i < value.length; i++) out[at + i] = value.charCodeAt(i); };
  ascii(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i] ?? 0, true);
  return out;
}

export async function makeSignature(pcm: Int16Array, rate = 11025): Promise<Signature | null> {
  let child: ReturnType<typeof Bun.spawn> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const python = findShazamPython();
    if (!python) return null;
    child = Bun.spawn([python, "-c", SCRIPT], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    const proc = child;
    const stdin = proc.stdin;
    const stdout = proc.stdout;
    if (!stdin || typeof stdin === "number" || !stdout || typeof stdout === "number") { proc.kill(); return null; }
    timer = setTimeout(() => { try { proc.kill(); } catch {} }, 15_000);
    const outputPromise = new Response(stdout).text();
    stdin.write(wavOf(pcm, rate));
    stdin.end();
    const [output, exitCode] = await Promise.all([outputPromise, proc.exited]);
    if (exitCode !== 0) return null;
    const parsed: unknown = JSON.parse(output);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as { uri?: unknown; ms?: unknown };
    return typeof row.uri === "string" && row.uri.startsWith("data:audio/vnd.shazam.sig;base64,") && typeof row.ms === "number" && Number.isFinite(row.ms)
      ? { uri: row.uri, sampleMs: Math.trunc(row.ms) } : null;
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); }
}
