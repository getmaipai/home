/**
 * Reserve a TCP port for a test process, then release it.
 *
 * FLAKE-LOAD-01 (cause d): asking the OS for port 0 hands out the EPHEMERAL range (49152 and up on macOS and Linux),
 * the same range every other process's outgoing connections and `port: 0` servers draw from, so a port released
 * here was sometimes taken by a parallel shard (or another session's tests) before the test bound it
 * ("Failed to start server. Is port N in use?" in the sidecars auto-heal tests). Ports are picked at random below the
 * ephemeral range instead, where only another reserveFreePort() caller can land, and the pick is checked on both the
 * loopback and the wildcard address before it is returned.
 */
const LOW = 20_000;
const SPAN = 25_000;

function bindable(port: number, hostname: "127.0.0.1" | "0.0.0.0"): boolean {
  try {
    Bun.serve({ hostname, port, fetch: () => new Response() }).stop(true);
    return true;
  } catch {
    return false;
  }
}

export function reserveFreePort(): number {
  if (process.env.MAIPAI_TEST_NO_PORTS === "1") {
    // Sandboxed runs cannot bind ports, and tests that start no server need only a placeholder.
    return LOW + Math.floor(Math.random() * SPAN);
  }

  for (let attempt = 0; attempt < 200; attempt++) {
    const port = LOW + Math.floor(Math.random() * SPAN);
    if (bindable(port, "127.0.0.1") && bindable(port, "0.0.0.0")) return port;
  }
  throw new Error("no free test port found in 200 tries; close other test runs and retry");
}
