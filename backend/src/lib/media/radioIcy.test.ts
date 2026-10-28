import { describe, expect, test } from "bun:test";
import { IcyDemuxer, parseStreamTitle, usableMetaint } from "@/lib/media/radioIcy";

const enc = new TextEncoder();
const block = (text: string): Uint8Array => {
  const body = enc.encode(text);
  const size = Math.ceil(body.length / 16);
  const out = new Uint8Array(1 + size * 16);
  out[0] = size;
  out.set(body, 1);
  return out;
};
const audio = (n: number, seed: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 0xff);
const join = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};

describe("parseStreamTitle", () => {
  test("reads the title and ignores StreamUrl and padding", () => {
    expect(parseStreamTitle(enc.encode("StreamTitle='Artist - Song';StreamUrl='https://example.com';\0\0\0"))).toBe("Artist - Song");
  });
  test("keeps an apostrophe inside the title", () => {
    expect(parseStreamTitle(enc.encode("StreamTitle='Don't Stop';\0\0"))).toBe("Don't Stop");
  });
  test("an empty title is null", () => expect(parseStreamTitle(enc.encode("StreamTitle='';\0"))).toBeNull());
  test("text that is not a title is null", () => expect(parseStreamTitle(enc.encode("Other='x';"))).toBeNull());
  test("falls back to latin1 when the bytes are not utf-8", () => {
    expect(parseStreamTitle(Uint8Array.from([...enc.encode("StreamTitle='Caf"), 0xe9, ...enc.encode("';")]))).toBe("Café");
  });
  test("caps a very long title", () => expect(parseStreamTitle(enc.encode(`StreamTitle='${"x".repeat(500)}';`))!.length).toBe(200));
});

describe("usableMetaint", () => {
  test("accepts 1 to 65536 and nothing else", () => {
    expect(usableMetaint("8192")).toBe(8192);
    for (const bad of [null, "", "0", "abc", "-1", "70000", "8192abc"]) expect(usableMetaint(bad)).toBeNull();
  });
});

describe("IcyDemuxer with metaint 8192", () => {
  const a1 = audio(8192, 1), a2 = audio(8192, 2), a3 = audio(100, 3);
  const stream = join([a1, block("StreamTitle='Blue Hour';"), a2, new Uint8Array([0]), a3]);

  test("removes the blocks and reports the title, whatever the chunk size", () => {
    for (const size of [1, 7, 4096, 8192, 8193, 20000]) {
      const titles: Array<string | null> = [];
      const demux = new IcyDemuxer(8192, (title) => titles.push(title));
      const out: Uint8Array[] = [];
      for (let at = 0; at < stream.length; at += size) out.push(...demux.push(stream.subarray(at, at + size)));
      expect(join(out)).toEqual(join([a1, a2, a3]));
      expect(titles).toEqual(["Blue Hour"]);
    }
  });

  test("a later block replaces the title and an empty one clears it", () => {
    const titles: Array<string | null> = [];
    const demux = new IcyDemuxer(8192, (title) => titles.push(title));
    demux.push(join([a1, block("StreamTitle='One';"), a2, block("StreamTitle='';"), a3]));
    expect(titles).toEqual(["One", null]);
  });
});
