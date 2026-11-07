// AUDIT-DUP-NET-01: the one Range server behind the files, videos, music, companions and library routes.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveBytes } from "@/lib/media/serve";

const bytes = new TextEncoder().encode("0123456789");
const ask = (range: string | undefined, source: Parameters<typeof serveBytes>[0] = bytes) => serveBytes(source, "video/mp4", range);

describe("serveBytes", () => {
  test("a request with no Range gets the whole body with its length and type", async () => {
    const res = ask(undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await res.text()).toBe("0123456789");
  });

  test("a closed range is a 206 slice", async () => {
    const res = ask("bytes=2-5");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("2345");
  });

  test("the suffix form is the last bytes of the file, not the first", async () => {
    const res = ask("bytes=-4");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 6-9/10");
    expect(await res.text()).toBe("6789");
  });

  test("an open-ended range runs to the end", async () => {
    const res = ask("bytes=7-");
    expect(res.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await res.text()).toBe("789");
  });

  test("an end past the end is clamped to the last byte", async () => {
    const res = ask("bytes=5-999");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 5-9/10");
    expect(await res.text()).toBe("56789");
  });

  test("a start past the end is a 416 that names the size", async () => {
    const res = ask("bytes=10-20");
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
    expect(await ask("bytes=50-").text()).toBe("");
  });

  test("a reversed range is a 416", () => {
    expect(ask("bytes=6-2").status).toBe(416);
  });

  test("a Range header it cannot read is ignored, as the RFC says", async () => {
    const res = ask("items=1-2");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789");
  });

  test("a file is sliced lazily and a source with its own slice works too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "servebytes-"));
    try {
      const path = join(dir, "clip.bin");
      writeFileSync(path, bytes);
      const res = ask("bytes=-3", Bun.file(path));
      expect(res.status).toBe(206);
      expect(await res.text()).toBe("789");
      const reads: Array<[number, number]> = [];
      const custom = ask("bytes=1-2", { size: 10, slice: (start = 0, end = 10) => { reads.push([start, end]); return bytes.subarray(start, end); } });
      expect(await custom.text()).toBe("12");
      expect(reads).toEqual([[1, 3]]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("caller headers replace the defaults", () => {
    const res = serveBytes(bytes, "image/png", undefined, { headers: { "accept-ranges": "bytes", "cache-control": "private, max-age=0, must-revalidate", etag: '"x"' } });
    expect(res.headers.get("etag")).toBe('"x"');
    expect(res.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
  });

  test("an empty file answers any range with a 416", () => {
    expect(ask("bytes=0-0", new Uint8Array()).status).toBe(416);
  });
});
