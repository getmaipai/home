// A deterministic, offline stand-in for Pocket TTS's real HTTP surface,
// for testing the client and the hub's tts supervisor without `uv`/Python
// or a real synthesis pass. Never used against a real household:
// ttsSupervisor.ts only starts this when MAIPAI_TTS_URL isn't configured
// and either `uv` isn't on PATH or MAIPAI_TTS_DISABLE_SPAWN is set (every
// test run, backend/tests/preload.ts), the same shape spec/llm/ts/
// stubServer.ts already set for the chat role.
export interface StubTtsServerHandle {
  url: string;
  stop: () => void;
}

const SAMPLE_RATE = 24_000;
const STUB_DURATION_SECONDS = 0.2;

/** A real, valid 16-bit PCM mono WAV file: silence, short enough to keep
 * tests fast. Built by hand rather than fetched/vendored (README.md's
 * "download, don't vendor" - there's nothing to download for a few
 * hundred milliseconds of silence). */
function buildSilentWav(): Uint8Array {
  const numSamples = Math.round(SAMPLE_RATE * STUB_DURATION_SECONDS);
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  // Samples stay zeroed (silence) - ArrayBuffer already zero-initializes.
  return new Uint8Array(buffer);
}

const STUB_WAV = buildSilentWav();

/** port 0 lets the OS assign a free port, avoiding a fixed-port clash
 * when tests and a dev server both start a stub. */
export function startStubTtsServer(port = 0): StubTtsServerHandle {
  const server = Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({ status: "healthy" });
      }
      if (url.pathname === "/tts" && req.method === "POST") {
        const form = await req.formData().catch(() => null);
        const text = form?.get("text");
        if (!text || typeof text !== "string") {
          return Response.json({ error: "text is required" }, { status: 400 });
        }
        return new Response(STUB_WAV, { headers: { "content-type": "audio/wav" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}
