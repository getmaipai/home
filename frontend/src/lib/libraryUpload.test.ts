import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import { uploadLibraryFile } from "@/lib/libraryUpload";

class FakeXhr {
  static last: FakeXhr | null = null;
  static sent = 0;
  status = 200;
  responseText = "";
  withCredentials = false;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() { FakeXhr.last = this; }
  open() {}
  addEventListener() {}
  send() { FakeXhr.sent += 1; queueMicrotask(() => this.onload?.()); }
  abort() { this.onabort?.(); }
}

const original = globalThis.XMLHttpRequest;
beforeEach(() => { FakeXhr.sent = 0; FakeXhr.last = null; (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr; });
afterEach(() => { (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = original; });

const file = new File(["hello"], "hello.txt", { type: "text/plain" });

describe("uploadLibraryFile failures", () => {
  test("a 2xx answer that is not JSON rejects with an ApiError that says what to do, and reports no finished progress", async () => {
    const progress: number[] = [];
    const pending = uploadLibraryFile(file, { onProgress: (sent) => progress.push(sent) });
    FakeXhr.last!.responseText = "<html>proxy page</html>";
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    await expect(pending).rejects.toMatchObject({ message: expect.stringContaining("Check your connection and try again."), status: 200 });
    expect(progress).toEqual([]);
  });

  test("a good answer still resolves with the kept file", async () => {
    const pending = uploadLibraryFile(file);
    FakeXhr.last!.responseText = JSON.stringify({ id: "file-1", name: "hello.txt", kind: "document", media_type: "text/plain", size_bytes: 5, duplicate: false });
    expect((await pending).id).toBe("file-1");
  });

  test("a signal that is already aborted rejects with AbortError and sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadLibraryFile(file, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.sent).toBe(0);
  });
});
