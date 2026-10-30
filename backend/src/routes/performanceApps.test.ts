import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHelperApps } from "@/lib/appHelperClient";

let server: Server | null = null;
let dir = "";
afterEach(() => { server?.close(); server = null; if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

describe("listHelperApps", () => {
  test("reads the helper's list and keeps only well-formed apps", async () => {
    dir = mkdtempSync(join(tmpdir(), "helper-"));
    const path = join(dir, "h.sock");
    server = createServer((socket) => socket.on("data", () => socket.write(`${JSON.stringify({ ok: true, apps: [{ bundleId: "com.apple.Safari", name: "Safari", bytes: 9e9, frontmost: false }, { nope: 1 }] })}\n`)));
    await new Promise<void>((resolve) => server!.listen(path, resolve));
    expect(await listHelperApps(path)).toEqual({ installed: true, apps: [{ bundleId: "com.apple.Safari", name: "Safari", bytes: 9e9, frontmost: false }] });
  });
  test("no socket reads as not installed", async () => {
    expect(await listHelperApps("/nonexistent/helper.sock")).toEqual({ installed: false, apps: [] });
  });
});
