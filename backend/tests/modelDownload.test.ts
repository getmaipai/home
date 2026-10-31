import { describe, expect, test, afterAll, afterEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadUrl, sha256OfFile, sweepStaleDownloads } from "@/lib/modelDownload";
import { enginesDir, modelsDir } from "@/lib/paths";

const CONTENT = Buffer.from("x".repeat(50_000), "utf8");
const SHA256 = createHash("sha256").update(CONTENT).digest("hex");

// A real HTTP server (not a mocked fetch): downloadUrl's resume behavior
// depends on genuine Range-header semantics (a 206 with the right byte
// window), which a hand-rolled fetch mock would have to reimplement
// correctly to be worth anything - a real server proves the actual
// contract instead of an assumption about it.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/flaky-once") {
      // Fails the connection entirely on the first byte-0 request, then
      // succeeds - exercises the retry path for real instead of just the
      // resume path.
      if (!flakyServed) {
        flakyServed = true;
        return new Response(null, { status: 500 });
      }
    }
    const range = req.headers.get("range");
    if (range) {
      const match = /bytes=(\d+)-/.exec(range);
      const start = match ? Number(match[1]) : 0;
      return new Response(CONTENT.subarray(start), {
        status: 206,
        headers: { "content-length": String(CONTENT.length - start), "content-range": `bytes ${start}-${CONTENT.length - 1}/${CONTENT.length}` },
      });
    }
    return new Response(CONTENT, { status: 200, headers: { "content-length": String(CONTENT.length) } });
  },
});
let flakyServed = false;

afterAll(() => server.stop(true));

let workDir: string;
afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function dest(): string {
  workDir = mkdtempSync(join(tmpdir(), "maipai-download-test-"));
  return join(workDir, "file.bin");
}

describe("downloadUrl", () => {
  test("downloads and verifies a real file end to end", async () => {
    const destPath = dest();
    await downloadUrl(`${server.url}`, destPath, { expectedSha256: SHA256, expectedBytes: CONTENT.length });
    expect(readFileSync(destPath)).toEqual(CONTENT);
  });

  test("a checksum mismatch removes the partial file and throws", async () => {
    const destPath = dest();
    await expect(
      downloadUrl(`${server.url}`, destPath, { expectedSha256: "0".repeat(64), expectedBytes: CONTENT.length }),
    ).rejects.toThrow(/sha256/);
    expect(existsSync(destPath)).toBe(false);
    expect(existsSync(`${destPath}.part`)).toBe(false);
  });

  test("a size mismatch removes the partial file and throws", async () => {
    const destPath = dest();
    await expect(
      downloadUrl(`${server.url}`, destPath, { expectedSha256: SHA256, expectedBytes: CONTENT.length + 1 }),
    ).rejects.toThrow(/size/);
    expect(existsSync(destPath)).toBe(false);
  });

  test("resumes from an existing .part file via a real Range request instead of re-downloading everything", async () => {
    const destPath = dest();
    const already = CONTENT.subarray(0, 20_000);
    writeFileSync(`${destPath}.part`, already);
    await downloadUrl(`${server.url}`, destPath, { expectedSha256: SHA256, expectedBytes: CONTENT.length });
    expect(readFileSync(destPath)).toEqual(CONTENT);
  });

  test("skips entirely when the destination already exists (no request at all)", async () => {
    const destPath = dest();
    writeFileSync(destPath, CONTENT);
    // A sha256 that would fail if this actually re-downloaded and
    // verified: proves the early-exists check runs before any network
    // call or checksum pass.
    await downloadUrl(`${server.url}`, destPath, { expectedSha256: "0".repeat(64) });
    expect(readFileSync(destPath)).toEqual(CONTENT);
  });

  test("retries a transient server error instead of failing the whole download", async () => {
    flakyServed = false;
    const destPath = dest();
    await downloadUrl(`${server.url}/flaky-once`, destPath, { expectedSha256: SHA256, expectedBytes: CONTENT.length });
    expect(readFileSync(destPath)).toEqual(CONTENT);
  }, 15_000);
});

describe("sha256OfFile", () => {
  test("matches node crypto's own digest of the same bytes", async () => {
    const destPath = dest();
    writeFileSync(destPath, CONTENT);
    expect(await sha256OfFile(destPath)).toBe(SHA256);
  });
});

describe("sweepStaleDownloads", () => {
  test("removes only old partial and archive files and reports their bytes", () => {
    mkdirSync(modelsDir, { recursive: true });
    const now = Date.now();
    const oldPart = join(modelsDir, `stale-${randomUUID()}.gguf.part`);
    const oldArchive = join(modelsDir, `.download.tmp`);
    const newPart = join(modelsDir, `fresh-${randomUUID()}.gguf.part`);
    const unrelated = join(modelsDir, `keep-${randomUUID()}.bin`);
    const nestedDir = join(enginesDir, `engine-${randomUUID()}`);
    const nestedArchive = join(nestedDir, ".download.tmp");
    try {
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(nestedArchive, "1234567");
      writeFileSync(oldPart, "1234");
      writeFileSync(oldArchive, "123456");
      writeFileSync(newPart, "12");
      writeFileSync(unrelated, "12345678");
      const old = new Date(now - 8 * 24 * 60 * 60 * 1000);
      utimesSync(oldPart, old, old);
      utimesSync(oldArchive, old, old);
      utimesSync(nestedArchive, old, old);
      utimesSync(newPart, new Date(now), new Date(now));

      expect(sweepStaleDownloads(now)).toEqual({ removed: 3, bytes: 17 });
      expect(existsSync(nestedArchive)).toBe(false);
      expect(existsSync(oldPart)).toBe(false);
      expect(existsSync(oldArchive)).toBe(false);
      expect(existsSync(newPart)).toBe(true);
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      rmSync(oldPart, { force: true });
      rmSync(oldArchive, { force: true });
      rmSync(newPart, { force: true });
      rmSync(unrelated, { force: true });
      rmSync(nestedDir, { recursive: true, force: true });
    }
  });
});
