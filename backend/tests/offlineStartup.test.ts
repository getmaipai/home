import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveFreePort } from "./fixtures/reserveFreePort";
import { startDefaultScriptedStack, type StackFixture } from "./stackFixture";
import { waitForBackendPort } from "../../scripts/screenshotRuntime";
import { declaredEndpointText } from "@/lib/privacy";

// OFFLINE-TEST-01 (a): the hub boots and serves a turn with outbound network
// denied at the process level (tests/fixtures/denyEgress.ts, loopback
// allowed). The Stack is a scripted one on loopback, the way a household's
// own Stack is. The test asserts only that the turn answered and that no
// denied destination is an undeclared one; it never asserts fixed wording.

const BACKEND = join(import.meta.dir, "..");
const PRELOAD = join(import.meta.dir, "fixtures", "denyEgress.ts");
const dirs: string[] = [];
const procs: Array<ReturnType<typeof Bun.spawn>> = [];
const stacks: StackFixture[] = [];

afterEach(async () => {
  for (const p of procs.splice(0)) {
    p.kill("SIGTERM");
    await Promise.race([p.exited, new Promise((r) => setTimeout(r, 10_000))]);
    p.kill("SIGKILL");
  }
  for (const s of stacks.splice(0)) s.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "maipai-offline-"));
  dirs.push(d);
  return d;
};

async function api(base: string, path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.cookie) headers.set("Cookie", init.cookie);
  return fetch(`${base}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
}

describe("OFFLINE-TEST-01: egress-denied startup and turn", () => {
  test("the egress guard refuses a public host and allows loopback (the guard itself is guarded)", async () => {
    const log = join(tmp(), "denied.log");
    const probe = Bun.spawn({
      cmd: [process.execPath, "--preload", PRELOAD, "-e",
        `const loop = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
         const ok = await (await fetch("http://127.0.0.1:" + loop.port)).text();
         let denied = "";
         try { await fetch("https://example.com/"); } catch (e) { denied = String(e.message); }
         let dnsDenied = false;
         try { await Bun.connect({ hostname: "203.0.113.9", port: 443, socket: { data() {} } }); } catch { dnsDenied = true; }
         console.log(JSON.stringify({ ok, denied, dnsDenied })); process.exit(0);`],
      env: { ...process.env, MAIPAI_DENY_EGRESS_LOG: log },
      stdout: "pipe", stderr: "pipe",
    });
    procs.push(probe);
    const out = JSON.parse((await new Response(probe.stdout).text()).trim().split("\n").at(-1)!) as { ok: string; denied: string; dnsDenied: boolean };
    expect(out.ok).toBe("ok");
    expect(out.denied).toContain("egress denied");
    expect(out.dnsDenied).toBe(true);
    expect(readFileSync(log, "utf8")).toContain("example.com");
  });

  test("a hub started with outbound denied boots, serves a turn, and only tries declared endpoints", async () => {
    const stack = startDefaultScriptedStack();
    stacks.push(stack);
    const dataDir = tmp();
    const deniedLog = join(dataDir, "denied-egress.log");
    const child = Bun.spawn({
      cmd: [process.execPath, "run", "--preload", PRELOAD, "src/index.ts"],
      cwd: BACKEND,
      env: {
        ...process.env,
        NODE_ENV: "production", // not "test": the child must use its real Stack client
        MAIPAI_DENY_EGRESS_LOG: deniedLog,
        MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1",
        MAIPAI_HUB_LOCK_PATH: join(dataDir, "hub.lock"),
        MAIPAI_MDNS: "off",
        PORT: "0",
        MAIPAI_DATA_DIR: join(dataDir, "data"),
        MAIPAI_BACKUP_DIR: join(dataDir, "backups"),
        MAIPAI_KEYSTORE_BACKEND: "file",
        MAIPAI_TTS_DISABLE_SPAWN: "1",
        MAIPAI_KIWIX_PORT: String(reserveFreePort()),
        MAIPAI_WYOMING_PORT: "0",
        MAIPAI_BACKGROUND_URL: "http://127.0.0.1:1",
        MAIPAI_WIKIPEDIA_BASE_URL: "http://127.0.0.1:1",
        MAIPAI_LLAMA_SERVER_URL: "",
        MAIPAI_EMBED_URL: "",
      },
      stdout: "pipe",
      stderr: Bun.file(join(dataDir, "child.err")),
    });
    procs.push(child);
    const out = child.stdout;
    if (!out || typeof out === "number") throw new Error("the hub gave no stdout");
    const port = await waitForBackendPort(out, 60_000);
    const base = `http://127.0.0.1:${port}`;

    const setup = await api(base, "/api/auth/setup", { method: "POST", body: JSON.stringify({ displayName: "Marlow", secret: "correcthorsebattery" }) });
    expect(setup.ok).toBe(true);
    const cookie = setup.headers.get("set-cookie")!.split(";")[0]!;
    for (const [key, value] of [["engines.stack.url", stack.url], ["engines.stack.use_chat", true], ["engines.stack.use_embeddings", true]] as const) {
      const put = await api(base, "/api/settings", { method: "PUT", cookie, body: JSON.stringify({ scope: "household", key, value }) });
      expect(put.ok, `setting ${key}`).toBe(true);
    }

    const turn = await api(base, "/api/turn/stream", { method: "POST", cookie, body: JSON.stringify({ surface: "chat", text: "say hello" }), signal: AbortSignal.timeout(60_000) });
    expect(turn.status, `${await turn.clone().text()}\n--- hub stderr ---\n${existsSync(join(dataDir, "child.err")) ? readFileSync(join(dataDir, "child.err"), "utf8").slice(-1500) : ""}\n--- stack calls ---\n${stack.calls.join(", ")}`).toBe(200);
    const events = (await turn.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { type: string; text?: string });
    const reply = events.filter((e) => e.type === "delta").map((e) => e.text ?? "").join("");
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(reply.trim().length).toBeGreaterThan(0);

    // Whatever the hub tried to reach while it was cut off must be declared.
    const declared = declaredEndpointText();
    const tried = existsSync(deniedLog)
      ? [...new Set(readFileSync(deniedLog, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")[0]!))]
      : [];
    // The boot-time internet probe and the Kiwix setup both reach out by default, so a guard that blocked nothing would mean it never engaged.
    expect(tried.length, "the egress guard recorded no denied attempt in the hub").toBeGreaterThan(0);
    const undeclared = tried.filter((host) => !declared.includes(host.toLowerCase()));
    expect(undeclared, `the hub tried to reach hosts that no declaration covers: ${undeclared.join(", ")}`).toEqual([]);
  }, 120_000);
});
