import { afterAll, beforeAll } from "bun:test";
import { join } from "node:path";
import { startStubLlmServer } from "@maipai/spec/llm/ts/stubServer.js";

export const BACKEND = join(import.meta.dir, "../..");
export const ENTRY_POINTS_A = ["tool-calling.ts", "naturalness.ts"];
export const ENTRY_POINTS_B = ["memory/run.ts", "judge-eval.ts", "parity-bisect.ts"];
export const ENTRY_POINTS_C = ["persona-eval.ts", "parity-bisect2.ts", "parity-bisect3.ts", "parity-bisect4.ts", "prefix-class-01-verify.ts", "style-adapter.ts"];
export let stub: { url: string; stop: () => Promise<void> };

export function setupBenchStub(): void {
  beforeAll(() => {
    stub = startStubLlmServer(0);
  });
  afterAll(async () => {
    await stub.stop();
  });
}

export async function runBench(entry: string, env: Record<string, string | undefined>): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["bun", "run", `scripts/bench/${entry}`], {
    cwd: BACKEND,
    env: { ...process.env, MAIPAI_LLAMA_SERVER_URL: undefined, MAIPAI_EMBED_URL: undefined, MAIPAI_BACKGROUND_URL: undefined, MAIPAI_DATA_DIR: undefined, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { code, out: `${out}\n${err}` };
}

export const stubEnv = () => ({ MAIPAI_LLAMA_SERVER_URL: stub.url, MAIPAI_EMBED_URL: stub.url, MAIPAI_BACKGROUND_URL: stub.url, MAIPAI_BENCH_REPEATS: "1" });
