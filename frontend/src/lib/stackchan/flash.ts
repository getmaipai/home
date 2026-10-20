import { ESPLoader, Transport } from "esptool-js";

export const FLASH_BYTES = 16 * 1024 * 1024;
export const ENROLL_NVS_OFFSET = 0x9000;
export const WRITE_ENROLL_NVS_ON_FIRST_INSTALL = true;
export type FlashPart = { path: string; offset: number; size: number; sha256: string };
export type FlashManifest = { builds: Array<{ chipFamily: string; parts: FlashPart[] }>; flash_size: string };
export type FlashStage = "Backing up" | "Writing" | "Checking" | "Restarting";
export interface FlashTransport {
  connect(): Promise<void>;
  read(address: number, size: number, progress?: (completed: number, total: number) => void): Promise<Uint8Array>;
  write(address: number, bytes: Uint8Array, progress?: (completed: number, total: number) => void): Promise<void>;
  md5(address: number, size: number): Promise<string>;
  hardReset(): Promise<void>;
  close?(): Promise<void>;
}
export type InstallCallbacks = { onStage?: (stage: FlashStage, completed?: number, total?: number) => void };

async function responseBytes(url: string, method = "GET"): Promise<Uint8Array> {
  const response = await fetch(url, { method, credentials: "include", cache: "no-store" });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error ?? `Home could not download ${url}. Check the connection and try again.`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function postBytes(url: string, bytes: Uint8Array): Promise<void> {
  const body = new ArrayBuffer(bytes.length);
  new Uint8Array(body).set(bytes);
  const response = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/octet-stream" }, body });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error ?? `Home could not save ${url}. Check the connection and try again.`);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Home could not complete ${url}. Check the connection and try again.`);
  return value;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = new ArrayBuffer(bytes.length);
  new Uint8Array(input).set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(hash), (part) => part.toString(16).padStart(2, "0")).join("");
}

export function md5Hex(bytes: Uint8Array): string {
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes); data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);
  let a0 = 0x67452301; let b0 = 0xefcdab89; let c0 = 0x98badcfe; let d0 = 0x10325476;
  for (let offset = 0; offset < paddedLength; offset += 64) {
    let a = a0; let b = b0; let c = c0; let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number; let g: number; let shift: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; shift = shifts[i % 4]!; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; shift = shifts[4 + (i % 4)]!; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; shift = shifts[8 + (i % 4)]!; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; shift = shifts[12 + (i % 4)]!; }
      const word = view.getUint32(offset + g * 4, true);
      const sum = (a + f + constants[i]! + word) >>> 0;
      const rotated = (sum << shift) | (sum >>> (32 - shift));
      [a, b, c, d] = [d, (b + rotated) >>> 0, b, c];
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 255).toString(16).padStart(2, "0")).join("")).join("");
}

export async function installStackChan(transport: FlashTransport, callbacks: InstallCallbacks & { onHostCreated?: (deviceId: string) => void } = {}, options: { firstInstall?: boolean } = {}): Promise<{ deviceId: string }> {
  const firstInstall = options.firstInstall ?? true;
  callbacks.onStage?.("Checking");
  const manifestResponse = await fetch("/api/robots/stackchan/flash-manifest", { credentials: "include", cache: "no-store" });
  if (!manifestResponse.ok) {
    const error = await manifestResponse.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error ?? "Home could not load the signed StackChan image. Check the connection and try again.");
  }
  const manifest = await manifestResponse.json() as FlashManifest;
  const parts = manifest.builds[0]?.parts;
  if (!parts?.length) throw new Error("The signed StackChan image has no flash parts. Update Home and try again.");
  const images = await Promise.all(parts.map(async (part) => {
    const bytes = await responseBytes(`/api/robots/stackchan/flash-parts/${encodeURIComponent(part.path)}`);
    if (bytes.length !== part.size || await sha256(bytes) !== part.sha256) throw new Error(`The StackChan image part ${part.path} did not pass its integrity check. Update Home and try again.`);
    return { part, bytes };
  }));

  try {
    callbacks.onStage?.("Backing up", 0, FLASH_BYTES);
    await transport.connect();
    const backup = await transport.read(0, FLASH_BYTES, (completed, total) => callbacks.onStage?.("Backing up", completed, total));
    if (backup.length !== FLASH_BYTES) throw new Error("The full flash backup was incomplete. Check the USB cable and try again.");
    const host = await postJson<{ device_id: string }>("/api/robots/hosts", { label: "StackChan" });
    callbacks.onHostCreated?.(host.device_id);
    await postBytes(`/api/robots/hosts/${encodeURIComponent(host.device_id)}/flash-backup`, backup);
    const image = await responseBytes(`/api/robots/hosts/${encodeURIComponent(host.device_id)}/enroll-image`, "POST");
    const regions = [...images.map(({ part, bytes }) => ({ address: part.offset, bytes })), ...(firstInstall && WRITE_ENROLL_NVS_ON_FIRST_INSTALL ? [{ address: ENROLL_NVS_OFFSET, bytes: image }] : [])];
    for (let index = 0; index < regions.length; index++) {
      const region = regions[index]!;
      callbacks.onStage?.("Writing", index, regions.length);
      await transport.write(region.address, region.bytes);
      callbacks.onStage?.("Checking", index + 1, regions.length);
      const actual = (await transport.md5(region.address, region.bytes.length)).toLowerCase();
      const expected = md5Hex(region.bytes);
      if (actual !== expected) throw new Error(`The flash check failed at address 0x${region.address.toString(16)}. Keep the robot connected and retry the install.`);
    }
    callbacks.onStage?.("Restarting");
    await transport.hardReset();
    return { deviceId: host.device_id };
  } finally {
    await transport.close?.();
  }
}

export function createBrowserSerialTransport(port: unknown): FlashTransport {
  const serialPort = port as ConstructorParameters<typeof Transport>[0];
  const transport = new Transport(serialPort, false);
  const loader = new ESPLoader({ transport, port: serialPort, baudrate: 460_800, romBaudrate: 460_800, debugLogging: false });
  let connected = false;
  return {
    async connect() { if (!connected) { await loader.main(); connected = true; } },
    read: (address, size, onProgress) => loader.readFlash(address, size, onProgress ? (_packet, completed, total) => onProgress(completed, total) : null),
    async write(address, bytes, onProgress) {
      await loader.writeFlash({ fileArray: [{ address, data: bytes }], flashMode: "keep", flashFreq: "keep", flashSize: "16MB", eraseAll: false, compress: true, reportProgress: (_i, complete, total) => onProgress?.(complete, total) });
    },
    md5: (address, size) => loader.flashMd5sum(address, size),
    hardReset: () => loader.after("hard_reset"),
    async close() { await transport.disconnect(); },
  };
}

export function browserCanFlash(target: Pick<Window, "isSecureContext"> = window, browserNavigator: Navigator = navigator): boolean {
  return "serial" in browserNavigator && Boolean((browserNavigator as Navigator & { serial?: unknown }).serial) && target.isSecureContext;
}
