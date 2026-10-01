import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { arch, cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { EMBED_PROOF_SENTENCES } from "./embed-proof-sentences";
import { compareEmbedding, renderEmbedTable, summarizeEmbed, type EmbedRow } from "./embedProofMetrics";

interface Args { stackUrl: string; homePort: number; out: string; lines: number; homeModel: string }
export function parseArgs(argv: string[]): Args {
  const args: Args = { stackUrl: "http://127.0.0.1:8770", homePort: 8796, out: "./embed-stack16-e-results.json", lines: 200, homeModel: "/Users/jessetorres/Developer/github.com/getmaipai/home/data/models/nomic-embed-text-v1.5.Q4_K_M.gguf" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (!["--stack-url", "--home-port", "--out", "--lines", "--home-model"].includes(flag)) throw new Error(`Unknown flag: ${flag}`);
    const value = argv[++i]; if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--stack-url") args.stackUrl = value;
    else if (flag === "--out") args.out = value;
    else if (flag === "--home-model") args.homeModel = value;
    else { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > (flag === "--lines" ? 200 : 65535)) throw new Error(`Invalid value for ${flag}`); if (flag === "--lines") args.lines = n; else args.homePort = n; }
  }
  return args;
}
const memoryPercent = async (): Promise<number> => {
  const text = await Bun.$`memory_pressure`.text(); const match = text.match(/System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/i);
  if (!match) throw new Error("Could not parse System-wide memory free percentage from memory_pressure");
  return Number(match[1]);
};
type Child = ChildProcess & { exitCode: number | null };
async function waitHealthy(url: string, child: Child): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Home llama-server exited before becoming healthy");
    try { const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) }); if (response.ok) return; } catch { /* keep waiting for this child */ }
    await Bun.sleep(500);
  }
  throw new Error("Home llama-server did not become healthy within 60 seconds");
}
async function stopChild(child: Child): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve()); child.kill("SIGTERM");
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 5000); timer.unref();
  });
}
async function vectors(url: string, input: string | string[]): Promise<number[][]> {
  const response = await fetch(`${url.replace(/\/$/, "")}/v1/embeddings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "embed", input }) });
  if (!response.ok) throw new Error(`Embeddings request ${url} failed with ${response.status}: ${await response.text()}`);
  const payload = await response.json() as { data?: Array<{ embedding?: number[] }> };
  if (!Array.isArray(payload.data) || payload.data.some((row) => !Array.isArray(row.embedding))) throw new Error(`Embeddings response from ${url} has no data[0].embedding vector`);
  return payload.data.map((row) => row.embedding!);
}
async function timed(url: string, sentence: string): Promise<{ vector: number[]; ms: number }> {
  const start = performance.now(); const result = await vectors(url, sentence); return { vector: result[0]!, ms: performance.now() - start };
}
async function json(url: string): Promise<any> { const response = await fetch(url); if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}: ${await response.text()}`); return response.json(); }
function rowsFromRoles(value: any): any[] { return Array.isArray(value) ? value : value.roles ?? []; }
function roleState(row: any): string | undefined { return typeof row?.state === "string" ? row.state : row?.state?.state; }
async function engineVersion(binary: string): Promise<string> {
  const process = spawn(binary, ["--version"], { stdio: ["ignore", "pipe", "ignore"] }); let out = "";
  process.stdout?.on("data", (chunk: Buffer) => { out += chunk.toString(); });
  await new Promise<void>((resolve) => process.once("close", () => resolve())); return out.trim() || "unknown";
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const free = await memoryPercent();
  if (free < 35) { console.error(`Free memory is ${free} percent; need at least 35 percent.`); process.exitCode = 3; return; }
  const base = args.stackUrl.replace(/\/$/, "");
  const rolePayload = await json(`${base}/stack/v1/roles`);
  const embed = rowsFromRoles(rolePayload).find((row) => row.id === "embed");
  if (!embed || roleState(embed) === "notInstalled") { console.error("The Stack's embed role is not installed. Install it first."); process.exitCode = 2; return; }
  process.env.MAIPAI_DATA_DIR ??= "/Users/jessetorres/Developer/github.com/getmaipai/home/data";
  let binary: string | null = null;
  try {
    const [{ detectHardware }, { engineBinaryPath }] = await Promise.all([import("@/lib/hardware"), import("@/lib/llmSupervisor")]);
    binary = engineBinaryPath(await detectHardware());
  } catch { /* surfaced as missing binary below */ }
  if (!binary) { console.error("Home's llama-server binary is missing."); process.exitCode = 2; return; }
  try { await access(binary, constants.X_OK); } catch { console.error(`Home's llama-server binary is missing: ${binary}`); process.exitCode = 2; return; }
  try { await access(args.homeModel, constants.R_OK); } catch { console.error(`Home's embedding model is missing: ${args.homeModel}`); process.exitCode = 2; return; }
  const homeUrl = `http://127.0.0.1:${args.homePort}`;
  let child: Child | undefined;
  try {
    child = spawn(binary, ["--model", args.homeModel, "--embedding", "--port", String(args.homePort), "--host", "127.0.0.1"], { stdio: "ignore", env: { ...process.env } }) as Child;
    await waitHealthy(homeUrl, child);
    await timed(homeUrl, "Warm up one short sentence."); await timed(base, "Warm up one short sentence.");
    const sentences = EMBED_PROOF_SENTENCES.slice(0, args.lines); const measured: Array<{ sentence: string; home: Awaited<ReturnType<typeof timed>>; stack: Awaited<ReturnType<typeof timed>> }> = [];
    for (const sentence of sentences) { const home = await timed(homeUrl, sentence); const stack = await timed(base, sentence); measured.push({ sentence, home, stack }); }
    let deterministic = true;
    for (const item of measured.slice(0, 5)) {
      const [homeRepeat, stackRepeat] = await Promise.all([vectors(homeUrl, item.sentence), vectors(base, item.sentence)]);
      deterministic &&= JSON.stringify(homeRepeat[0]) === JSON.stringify(item.home.vector) && JSON.stringify(stackRepeat[0]) === JSON.stringify(item.stack.vector);
    }
    const batch = async (url: string): Promise<{ seconds: number; sentencesPerSecond: number; arrayInput: boolean }> => {
      const start = performance.now();
      try {
        for (let i = 0; i < sentences.length; i += 20) await vectors(url, sentences.slice(i, i + 20));
        const seconds = (performance.now() - start) / 1000; return { seconds, sentencesPerSecond: sentences.length / seconds, arrayInput: true };
      } catch (error) {
        if (!(error instanceof Error) || !/400|422|array|input/i.test(error.message)) throw error;
        const serialStart = performance.now(); for (const sentence of sentences) await vectors(url, sentence);
        const seconds = (performance.now() - serialStart) / 1000; return { seconds, sentencesPerSecond: sentences.length / seconds, arrayInput: false };
      }
    };
    let homeBatch = await batch(homeUrl); let stackBatch = await batch(base);
    if (!homeBatch.arrayInput || !stackBatch.arrayInput) {
      const serial = async (url: string) => { const start = performance.now(); for (const sentence of sentences) await vectors(url, sentence); const seconds = (performance.now() - start) / 1000; return { seconds, sentencesPerSecond: sentences.length / seconds, arrayInput: false }; };
      homeBatch = await serial(homeUrl); stackBatch = await serial(base); console.log("Batch routes did not both accept array input; serial requests were used on both sides.");
    }
    const batchRatio = stackBatch.sentencesPerSecond / homeBatch.sentencesPerSecond;
    const singleMsDelta = measured.map((item) => item.stack.ms - item.home.ms).sort((a, b) => a - b)[Math.floor(measured.length / 2)] ?? Infinity;
    const rows: EmbedRow[] = measured.map((item, index) => ({ line: index + 1, sentence: item.sentence, ...compareEmbedding(item.home.vector, item.stack.vector), homeMs: item.home.ms, stackMs: item.stack.ms, deterministic, singleMsDelta, batchRatio }));
    const summary = summarizeEmbed(rows); console.log(renderEmbedTable(rows, summary));
    const health = await json(`${base}/healthz`);
    const catalog = await json(`${base}/stack/v1/models/catalog`);
    const pinnedModel = (catalog.models as any[] | undefined)?.find((model) => model.id === "nomic-embed-text-v1-5-q4-k-m");
    const engineList = await json(`${base}/stack/v1/engines`);
    const stackEngine = (engineList.engines as any[] | undefined)?.find((engine) => engine.name === "llama-server");
    const hardware = { arch: arch(), cpu: cpus()[0]?.model ?? "unknown", totalMemoryGb: Number((totalmem() / 1e9).toFixed(2)) };
    const build = await engineVersion(binary);
    const output = { versions: { stack: health.version ?? "unknown", stackEmbedRole: embed, stackLlamaServer: stackEngine?.currentTag ?? "unknown", homeLlamaServer: build }, model: { file: "nomic-embed-text-v1.5.Q4_K_M.gguf", homePath: args.homeModel, stackRevision: pinnedModel?.revision ?? "unknown" }, hardware, memoryFreePercent: free, determinismChecked: Math.min(5, rows.length), deterministic, timings: { homeSingleMedianMs: median(measured.map((item) => item.home.ms)), stackSingleMedianMs: median(measured.map((item) => item.stack.ms)), homeBatch, stackBatch }, rows: rows.map(({ sentence, ...row }) => row), summary };
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, JSON.stringify(output, null, 2));
    process.exitCode = summary.passed ? 0 : 1;
  } finally { if (child) await stopChild(child); }
}
function median(values: number[]): number { const ordered = [...values].sort((a, b) => a - b); if (!ordered.length) return 0; const mid = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2; }
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
