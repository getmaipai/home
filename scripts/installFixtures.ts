import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";

// HOME-STACK-01: install.sh's Stack functions are pure bash, sourced
// (not executed - see the script's own "am I sourced" guard at the
// bottom) so each is called directly the way a real run would, rather
// than a TypeScript reimplementation that could drift from what the
// script actually does.
export const INSTALL_SH = join(import.meta.dir, "install.sh");
export const ENGINE_HELPER = join(import.meta.dir, "engine-computer", "maipai-engine");
export const PAIR_RESPONSE = join(import.meta.dir, "engine-computer", "pair-response.py");

export async function readChild(process: ReturnType<typeof Bun.spawn>) {
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout as ReadableStream<Uint8Array>).text(),
    new Response(process.stderr as ReadableStream<Uint8Array>).text(),
  ]);
  return { exitCode, stdout, stderr };
}

export async function startPairServer(body: Record<string, string>, expectedPath?: string, status = 200) {
  const source = `
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
      const path = new URL(request.url).pathname;
      if (process.env.EXPECTED_PATH && path !== process.env.EXPECTED_PATH) return new Response("wrong path", { status: 404 });
      return Response.json(JSON.parse(process.env.RESPONSE_BODY), { status: Number(process.env.RESPONSE_STATUS || 200) });
    }});
    console.log(server.port);
    process.on("SIGTERM", () => { server.stop(true); process.exit(0); });
  `;
  const child = Bun.spawn(["bun", "-e", source], {
    env: { ...process.env, RESPONSE_BODY: JSON.stringify(body), EXPECTED_PATH: expectedPath ?? "", RESPONSE_STATUS: String(status) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  let line = "";
  while (!line.includes("\n")) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`Mock server exited before ready: ${await new Response(child.stderr as ReadableStream<Uint8Array>).text()}`);
    line += new TextDecoder().decode(chunk.value);
  }
  return { child, port: Number(line.trim()) };
}

export async function stopPairServer(child: ReturnType<typeof Bun.spawn>) {
  child.kill("SIGTERM");
  await child.exited;
}

export function bashCall(cmd: string): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["bash", "-c", `source "${INSTALL_SH}"; ${cmd}`]);
  return { stdout: result.stdout.toString().trim(), stderr: result.stderr.toString(), exitCode: result.exitCode };
}

export function runScript(args: string[]): { stdout: string; exitCode: number } {
  const result = Bun.spawnSync(["bash", INSTALL_SH, ...args]);
  return { stdout: result.stdout.toString(), exitCode: result.exitCode };
}

