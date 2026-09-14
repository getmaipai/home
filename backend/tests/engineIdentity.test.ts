import { describe, expect, test } from "bun:test";
import { hostLabel, sanitizeEngineUrl, readEngineIdentity, formatEngineIdentity } from "@/lib/engineIdentity";

// ENGINE-HOST-01: an engine on another machine is reported as what it
// is (build, model file, health) and where it is only as a label.
describe("engineIdentity", () => {
  test("a loopback URL is local and shown; any other host is external and never shown", () => {
    expect(hostLabel("http://127.0.0.1:8788")).toBe("local");
    expect(hostLabel("http://localhost:8788")).toBe("local");
    expect(hostLabel("http://[::1]:8788")).toBe("local");
    expect(hostLabel("http://192.0.2.10:8788")).toBe("external");
    expect(hostLabel("http://engines.example.com:8788")).toBe("external");
    expect(sanitizeEngineUrl("http://127.0.0.1:8788")).toBe("http://127.0.0.1:8788");
    expect(sanitizeEngineUrl("http://192.0.2.10:8788")).toBe("external");
    expect(sanitizeEngineUrl("not a url")).toBe("external");
    expect(sanitizeEngineUrl(undefined)).toBe("n/a");
  });

  test("reads the build and the model file name from /props and the answer from /health, bounded and never throwing", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const path = new URL(req.url).pathname;
        if (path === "/health") return Response.json({ status: "ok" });
        if (path === "/props") return Response.json({ build_info: "b10797-832fd6f17", model_path: "/srv/models/qwen3-8b-instruct-q4-k-m.gguf" });
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const identity = await readEngineIdentity(`http://127.0.0.1:${server.port}`);
      expect(identity).toEqual({ host: "local", build: "b10797-832fd6f17", model: "qwen3-8b-instruct-q4-k-m.gguf", healthy: true });
      expect(formatEngineIdentity(identity)).toBe("local b10797-832fd6f17 qwen3-8b-instruct-q4-k-m.gguf");
    } finally {
      server.stop(true);
    }
    // Nothing answering: unhealthy, no build, no model, no throw.
    const dead = await readEngineIdentity("http://127.0.0.1:1", 500);
    expect(dead).toEqual({ host: "local", build: null, model: null, healthy: false });
    expect(formatEngineIdentity(dead)).toBe("local"); // health is the probe's, never the line's
    const { identityIncomplete, modelFileName } = await import("@/lib/engineIdentity");
    expect(identityIncomplete(dead)).toBe(true);
    expect(modelFileName("C:\\models\\qwen3-8b.gguf")).toBe("qwen3-8b.gguf"); // an engine on a Windows machine
    expect(modelFileName("/srv/models/qwen3-8b.gguf")).toBe("qwen3-8b.gguf");
    expect(formatEngineIdentity(null)).toBe("none");
    expect(formatEngineIdentity({ host: "stub", build: null, model: null, healthy: null })).toBe("stub");
  });
});
