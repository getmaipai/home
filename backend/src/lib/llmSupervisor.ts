// The router skeleton for platform plan 4.11's `chat` role, the "engine
// is llama-server, only" supervisor scaled down to exactly one role and
// one process, since that's all this pass has a real caller for. See
// spec/llm/README.md for the full scope and what's deferred (the real
// residency policy across many roles, GPU placement, KV cache tuning);
// this is the seed a future pass grows into that, not a mock of it.
//
// Which backend answers `chat` is chosen once, lazily, on first use, in
// this order:
//   1. MAIPAI_LLAMA_SERVER_URL - point at an already-running server
//      (real or someone else's stub). Nothing is spawned.
//   2. MAIPAI_LLAMA_SERVER_BIN + MAIPAI_CHAT_MODEL_PATH - spawn a real
//      llama-server as a child process.
//   3. Neither set (every dev machine and the test suite today) - start
//      the in-process stub server. Real code path, canned answers; see
//      spec/llm/README.md's "What's real vs. stubbed".
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { startStubLlmServer } from "@maipai/spec/llm/ts/stubServer.js";

interface ChatBackend {
  client: LlamaServerClient;
  stop: () => void;
}

let chatBackend: ChatBackend | null = null;
let startingPromise: Promise<ChatBackend> | null = null;

async function waitForHealth(client: LlamaServerClient, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.health()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`llama-server did not become healthy within ${timeoutMs}ms`);
}

async function spawnLlamaServer(bin: string, modelPath: string): Promise<ChatBackend> {
  // One fixed port: this pass supervises exactly one chat process, not a
  // pool, so there's nothing to pick a free port among yet. A second role
  // (e.g. router) would need real port allocation, deferred with the rest
  // of the multi-role residency policy.
  const port = Number(process.env.MAIPAI_LLAMA_SERVER_PORT ?? 8788);
  const proc = Bun.spawn([bin, "--model", modelPath, "--port", String(port), "--host", "127.0.0.1"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const client = new LlamaServerClient(`http://127.0.0.1:${port}`);
  try {
    await waitForHealth(client, 60_000);
  } catch (err) {
    proc.kill();
    throw err;
  }
  return { client, stop: () => proc.kill() };
}

async function startChatBackend(): Promise<ChatBackend> {
  const configuredUrl = process.env.MAIPAI_LLAMA_SERVER_URL;
  if (configuredUrl) {
    return { client: new LlamaServerClient(configuredUrl), stop: () => {} };
  }

  const bin = process.env.MAIPAI_LLAMA_SERVER_BIN;
  const modelPath = process.env.MAIPAI_CHAT_MODEL_PATH;
  if (bin && modelPath) {
    return spawnLlamaServer(bin, modelPath);
  }

  const stub = startStubLlmServer();
  return { client: new LlamaServerClient(stub.url), stop: stub.stop };
}

/** Lazily starts (once) and returns the client for the `chat` role.
 * Concurrent first callers share one in-flight start, never race to spawn
 * two backends. A failed start clears `startingPromise` so the *next*
 * call retries fresh instead of replaying the same rejection forever: a
 * code review (2026-09-04) found the original version left a rejected
 * promise cached, permanently wedging the role after one transient
 * failure (a briefly-wrong model path, a taken port, a slow first load
 * past the health timeout) until the whole process restarted. */
export async function getChatClient(): Promise<LlamaServerClient> {
  if (chatBackend) return chatBackend.client;
  if (!startingPromise) {
    startingPromise = startChatBackend()
      .then((backend) => {
        chatBackend = backend;
        return backend;
      })
      .catch((err) => {
        startingPromise = null;
        throw err;
      });
  }
  return (await startingPromise).client;
}

/** Test-only: stop whatever backend is running (spawned process or stub
 * server) and clear the cached client, the same reset-between-test-files
 * shape as resetDb()/__clearSessionCacheForTests. */
export function __resetLlmSupervisorForTests(): void {
  chatBackend?.stop();
  chatBackend = null;
  startingPromise = null;
}
