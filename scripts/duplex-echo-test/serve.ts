import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

const folder = import.meta.dir;
const requested = process.env.PORT ? Number(process.env.PORT) : undefined;
async function freePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const available = await new Promise<boolean>(resolve => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error("No free port found");
}
// A spoken sentence for the test, made once with the Mac's own voice; without `say` the page falls back to noise.
const speechPath = join(tmpdir(), "maipai-duplex-echo-speech.wav");
try {
  await Bun.$`say -o ${speechPath} --data-format=LEI16@22050 "Hello, this is Home speaking. I am telling you a short story about a robot who learned to listen while it talked, so please do not interrupt me yet."`.quiet();
} catch {}
const port = requested || await freePort(8890);
const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      async fetch(request) {
        const name = new URL(request.url).pathname.slice(1) || "index.html";
        if (name === "speech.wav") {
          const file = Bun.file(speechPath);
          return (await file.exists()) ? new Response(file, { headers: { "content-type": "audio/wav", "cache-control": "no-store" } }) : new Response("Not found", { status: 404 });
        }
        if (name.includes("..") || !(await readdir(folder)).includes(name)) return new Response("Not found", { status: 404 });
        const body = await readFile(join(folder, name));
        const type = name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".mjs") ? "text/javascript; charset=utf-8" : "text/plain; charset=utf-8";
        return new Response(body, { headers: { "content-type": type, "cache-control": "no-store" } });
      },
    });
console.log(`Echo test: http://localhost:${server.port}/`);
