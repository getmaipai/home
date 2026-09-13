/** Reserve an OS-assigned TCP port for a test process, then release it. */
export function reserveFreePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error("OS did not assign a port");
  return port;
}
