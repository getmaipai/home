import { describe, expect, test } from "bun:test";
import { crc32, decodeSignature, encodeSignature, makeSignature, signatureUri, type Signature } from "./shazamSignature";

describe("Shazam acoustic signatures", () => {
  test("round trips every peak", () => {
    const signature: Signature = { sampleRate: 16000, samples: 192000, bands: [[{ pass: 3, magnitude: 90, bin: 23 }], [{ pass: 300, magnitude: 200, bin: 44 }], [], [{ pass: 301, magnitude: 201, bin: 99 }]] };
    expect(decodeSignature(encodeSignature(signature))).toEqual(signature);
  });
  test("is deterministic and finds a 1 kHz tone in band 1", () => {
    const tone = Int16Array.from({ length: 96000 }, (_, i) => Math.round(Math.sin(2 * Math.PI * 1000 * i / 16000) * (6000 + 6000 * Math.sin(2 * Math.PI * 3 * i / 16000))));
    const a = makeSignature(tone)!;
    expect(makeSignature(tone)).toEqual(a);
    expect(a.samples).toBe(192000);
    expect(a.bands[1].length).toBeGreaterThan(0);
    expect([0, 2, 3].map((i) => a.bands[i as 0 | 2 | 3])).toEqual([[], [], []]);
  });
  test("silence has no peaks and short input is zero padded", () => {
    const quiet = makeSignature(new Int16Array(128))!;
    expect(quiet.bands.flat()).toHaveLength(0);
    expect(quiet.samples).toBe(192000);
    expect(makeSignature(new Int16Array(127))).toBeNull();
  });
  test("writes the expected header and rejects a bad CRC", () => {
    const bytes = encodeSignature({ sampleRate: 16000, samples: 192000, bands: [[{ pass: 1, magnitude: 2, bin: 3 }], [], [], []] });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0xcafe2580);
    expect(view.getUint32(12, true)).toBe(0x94119c00);
    expect(view.getUint32(28, true)).toBe(3 << 27);
    expect(view.getUint32(8, true)).toBe(bytes.length - 48);
    expect(view.getUint32(4, true)).toBe(crc32(bytes.subarray(8)));
    expect(view.getUint32(48, true)).toBe(0x40000000);
    bytes[60] = bytes[60]! ^ 1;
    expect(decodeSignature(bytes)).toBeNull();
  });
  test("uses the Shazam signature data URI", () => {
    expect(signatureUri({ sampleRate: 16000, samples: 192000, bands: [[], [], [], []] })).toStartWith("data:audio/vnd.shazam.sig;base64,");
  });
});
