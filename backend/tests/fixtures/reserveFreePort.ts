/** Reserve an OS-assigned TCP port for a test process, then release it. */
export function reserveFreePort(): number {
  // Try a wide range of high ports in descending order.
  const ports: number[] = [];
  for (let p = 65535; p >= 49152; p--) {
    ports.push(p);
  }
  // If all else fails, fall back to port 0 (let OS pick).
  ports.push(0);

  for (const port of ports) {
    try {
      const result = Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch: () => new Response(),
      });
      const boundPort = result.port;
      result.stop(true);
      if (boundPort === undefined) throw new Error("OS did not assign a port");
      return boundPort;
    } catch {
      // Port in use, try next
    }
  }
  throw new Error("No free port found in ephemeral range");
}

export function killPort(port: number): void {
  try {
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response(),
      timeout: 10,
    });
  } catch {
    // Port was never in use
  }
}
