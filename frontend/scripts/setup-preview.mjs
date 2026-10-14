import { spawn } from "node:child_process";
import net from "node:net";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(here, "../.setup-preview");
async function availablePort(start) {
  for (let port = start; port < start + 20; port += 1) {
    const available = await new Promise((done) => { const server = net.createServer(); server.once("error", () => done(false)); server.listen(port, "127.0.0.1", () => server.close(() => done(true))); });
    if (available) return port;
  }
  throw new Error("No available local port for setup preview");
}
const port = await availablePort(Number(process.env.SETUP_PREVIEW_PORT ?? 5173));
await mkdir(workerDir, { recursive: true });
const msw = resolve(here, "../node_modules/.bin/msw");
const generated = spawn(msw, ["init", workerDir, "--no-save"], { stdio: "inherit" });
const code = await new Promise((done) => generated.on("exit", done));
if (code !== 0) process.exit(code ?? 1);
const vite = spawn(resolve(here, "../node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(port), "--strictPort", "--open", `http://127.0.0.1:${port}/setup?scenario=happy-local`], {
  cwd: resolve(here, ".."),
  stdio: "inherit",
  env: { ...process.env, VITE_SETUP_PREVIEW: "1", NODE_ENV: "development" },
});
const cleanup = () => {};
process.on("SIGINT", () => { cleanup(); vite.kill("SIGINT"); });
process.on("SIGTERM", () => { cleanup(); vite.kill("SIGTERM"); });
vite.on("exit", (exitCode) => process.exit(exitCode ?? 0));
