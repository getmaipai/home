/** Minimal Stack surface for screenshot runs: chat and embeddings go to
 * the scripted OpenAI stub, with matching ready roles for discovery. */
export function startScreenshotStack(modelUrl: string, includeAlternateChatModel = false): ReturnType<typeof Bun.serve> {
  const model = modelUrl.replace(/\/$/, "");
  const identityHeaders = (headers: Headers) => {
    headers.set("x-maipai-engine", "stub screenshot");
    headers.set("x-maipai-model", "stub-chat");
    headers.set("x-maipai-revision", "screenshot");
    return headers;
  };
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/stack/v1/roles") {
        const state = () => ({ state: "ready", since: new Date().toISOString() });
        const check = () => ({ state: "passed", at: new Date().toISOString(), reason: null, stale: false });
        const modelInfo = (id: string) => ({ id, sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: null, estimated: true });
        return Response.json({ roles: [
          { id: "chat", label: "Chat", wire: "chat", residency: "resident", endpoints: ["/v1/chat/completions"], quality: ["everyday"], sharesModelWith: null, state: state(), reason: null, model: modelInfo("stub-chat"), check: check(), models: [{ id: "stub-chat", name: "Screenshot stub" }, ...(includeAlternateChatModel ? [{ id: "stub-chat-alt", name: "Alternate screenshot stub", description: "For regenerate menu capture" }] : [])] },
          { id: "embed", label: "Embeddings", wire: "embeddings", residency: "resident", endpoints: ["/v1/embeddings"], quality: [], sharesModelWith: null, state: state(), reason: null, model: modelInfo("stub-embed"), check: check() },
        ] });
      }
      if (request.method === "GET" && url.pathname === "/stack/v1/engines") {
        return Response.json({ engines: [] });
      }
      if (request.method === "GET" && url.pathname === "/stack/v1/hardware/budget") {
        return Response.json({
          totalMemoryBytes: 8 * 1024 ** 3,
          capBytes: 8 * 1024 ** 3,
          freeMemoryBytes: 6 * 1024 ** 3,
          availablePercent: 75,
          pressure: "normal",
          memoryReadingDegraded: false,
          loaded: [],
          queue: [],
        });
      }
      if (request.method === "GET" && url.pathname === "/stack/v1/health") return Response.json({ health: [] });
      if (request.method === "POST" && ["/v1/chat/completions", "/v1/embeddings"].includes(url.pathname)) {
        const path = url.pathname;
        if (path === "/v1/embeddings") {
          const response = await fetch(`${model}${path}`, { method: "POST", headers: request.headers, body: request.body, signal: request.signal });
          return new Response(response.body, { status: response.status, statusText: response.statusText, headers: identityHeaders(new Headers(response.headers)) });
        }
        const response = await fetch(`${model}${path}`, { method: "POST", headers: request.headers, body: request.body, signal: request.signal });
        const headers = identityHeaders(new Headers(response.headers));
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
}
