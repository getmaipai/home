// The hub's own base URL, as reachable from a sibling local process on
// this same machine (2026-09-04, voice cloning): `pocket-tts serve`
// fetches a cloned voice's audio by plain HTTP URL
// (routes/voice.ts's `GET /cloned/:id/file`), so that URL has to point
// back at wherever THIS process is actually listening, not an assumed
// constant - index.ts's own `port` reads the identical env var.
export function selfBaseUrl(): string {
  const port = Number(process.env.PORT ?? 8787);
  return `http://127.0.0.1:${port}`;
}
