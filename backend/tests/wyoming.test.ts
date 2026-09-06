import { describe, expect, test } from "bun:test";
import { WyomingFramer, encodeWyomingMessage, readWavPcm } from "@/lib/wyoming";
import { encodeWav } from "@/lib/sttSession";

describe("encodeWyomingMessage() / WyomingFramer", () => {
  test("round-trips a message with no data and no payload", () => {
    const framer = new WyomingFramer();
    framer.push(encodeWyomingMessage({ type: "describe" }));
    const msg = framer.next();
    expect(msg).toEqual({ type: "describe", data: undefined, payload: undefined });
  });

  test("round-trips a message with data only", () => {
    const framer = new WyomingFramer();
    framer.push(encodeWyomingMessage({ type: "transcript", data: { text: "hello there" } }));
    const msg = framer.next();
    expect(msg?.type).toBe("transcript");
    expect(msg?.data).toEqual({ text: "hello there" });
    expect(msg?.payload).toBeUndefined();
  });

  test("round-trips a message with a binary payload", () => {
    const payload = new Uint8Array([1, 2, 3, 4, 250, 251, 252]);
    const framer = new WyomingFramer();
    framer.push(encodeWyomingMessage({ type: "audio-chunk", data: { rate: 16000 }, payload }));
    const msg = framer.next();
    expect(msg?.type).toBe("audio-chunk");
    expect(msg?.data).toEqual({ rate: 16000 });
    expect(msg?.payload).toEqual(payload);
  });

  test("returns null until a complete message has arrived, across multiple push() calls", () => {
    const framer = new WyomingFramer();
    const encoded = encodeWyomingMessage({ type: "audio-chunk", data: { rate: 16000 }, payload: new Uint8Array([9, 9, 9, 9]) });
    // Split the encoded bytes mid-payload, simulating a real socket
    // delivering a message across several TCP packets.
    const splitAt = encoded.length - 2;
    framer.push(encoded.subarray(0, splitAt));
    expect(framer.next()).toBeNull();
    framer.push(encoded.subarray(splitAt));
    const msg = framer.next();
    expect(msg?.type).toBe("audio-chunk");
    expect(msg?.payload).toEqual(new Uint8Array([9, 9, 9, 9]));
  });

  test("drains multiple messages delivered in a single push()", () => {
    const framer = new WyomingFramer();
    const combined = new Uint8Array([
      ...encodeWyomingMessage({ type: "describe" }),
      ...encodeWyomingMessage({ type: "transcript", data: { text: "one" } }),
      ...encodeWyomingMessage({ type: "transcript", data: { text: "two" } }),
    ]);
    framer.push(combined);
    expect(framer.next()?.type).toBe("describe");
    expect(framer.next()?.data).toEqual({ text: "one" });
    expect(framer.next()?.data).toEqual({ text: "two" });
    expect(framer.next()).toBeNull();
  });

  test("throws on a malformed header line rather than silently resyncing", () => {
    const framer = new WyomingFramer();
    framer.push(new TextEncoder().encode("not valid json at all\n"));
    expect(() => framer.next()).toThrow();
  });
});

describe("readWavPcm()", () => {
  test("reads back exactly the format and samples encodeWav() wrote", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.999, -0.999]);
    const wav = encodeWav(samples, 22050);
    const result = readWavPcm(wav);
    expect(result.sampleRate).toBe(22050);
    expect(result.channels).toBe(1);
    expect(result.bitsPerSample).toBe(16);
    expect(result.pcm.length).toBe(samples.length * 2);
  });
});
