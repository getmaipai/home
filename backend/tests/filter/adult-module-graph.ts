import { checkRequest, loadedModules } from "@/lib/filter/door";

const audience = { actor: { id: "adult-graph", role: "adult" } as never, band: "adult" as const };
const call = (surface: "reply" | "picture") => checkRequest({
  surface, audience,
  request: { kind: "text", surface, point: "request", text: "hello", field: "prompt", lane: "adult" },
});
await call("reply");
await call("picture");
const runtime = globalThis as typeof globalThis & { Loader?: { registry?: Map<unknown, unknown> }; require?: { cache?: Record<string, unknown> } };
const graph = runtime.require?.cache ? Object.keys(runtime.require.cache) : runtime.Loader?.registry ? [...runtime.Loader.registry.keys()].map(String) : null;
console.log(JSON.stringify({ graph, loaded: loadedModules() }));
