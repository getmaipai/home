import { afterEach, describe, expect, test, mock } from "bun:test";
import { installStackChan, md5Hex, type FlashTransport } from "./flash";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const digest = async (data: Uint8Array) => {
  const copy = new ArrayBuffer(data.length); new Uint8Array(copy).set(data);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

function standIn() {
  const writes: Array<{ address: number; bytes: Uint8Array }> = [];
  const stored = new Map<number, Uint8Array>();
  const transport: FlashTransport = {
    connect: async () => {},
    read: async (_address, size) => new Uint8Array(size),
    write: async (address, bytes) => { writes.push({ address, bytes }); stored.set(address, bytes); },
    md5: async (address) => md5Hex(stored.get(address) ?? new Uint8Array()),
    hardReset: async () => {},
  };
  return { transport, writes };
}

function stub(part: Uint8Array, expectedSha = "") {
  const manifest = { flash_size: "16MB", builds: [{ chipFamily: "ESP32-S3", parts: [{ path: "app.bin", offset: 0x10000, size: part.length, sha256: expectedSha || "0".repeat(64) }] }] };
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("flash-manifest")) return Response.json(manifest);
    if (url.endsWith("app.bin")) { const copy = new ArrayBuffer(part.length); new Uint8Array(copy).set(part); return new Response(copy); }
    if (url.endsWith("flash-backup")) return Response.json({ saved: true });
    if (url.endsWith("/hosts")) return Response.json({ device_id: "device-test" });
    if (url.endsWith("enroll-image")) return new Response(new Uint8Array([7, 8, 9]));
    throw new Error(`Unexpected ${init?.method ?? "GET"} ${url}`);
  }) as unknown as typeof fetch;
}

describe("StackChan browser flash", () => {
  test("calculates the expected MD5 digest for device verification", () => {
    expect(md5Hex(new TextEncoder().encode("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  test("checks all image hashes before touching the serial transport", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    stub(bytes);
    const { transport, writes } = standIn();
    await expect(installStackChan(transport)).rejects.toThrow("did not pass its integrity check");
    expect(writes).toEqual([]);
  });

  test("writes each signed part at its offset and NVS only for a first install", async () => {
    const part = new Uint8Array([1, 2, 3, 4]);
    stub(part, await digest(part));
    const { transport, writes } = standIn();
    await installStackChan(transport);
    expect(writes.map((write) => write.address)).toEqual([0x10000, 0x9000]);

    stub(part, await digest(part));
    const next = standIn();
    await installStackChan(next.transport, {}, { firstInstall: false });
    expect(next.writes.map((write) => write.address)).toEqual([0x10000]);
  });
});
