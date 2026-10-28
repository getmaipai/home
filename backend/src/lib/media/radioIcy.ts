// RADIO-03: Shoutcast/Icecast in-band metadata ("ICY"). A server that was sent `Icy-MetaData: 1` answers with an `icy-metaint: N` header
// and then puts a metadata block after every N audio bytes: one length byte (times 16), then that many bytes of text such as
// `StreamTitle='Artist - Song';`. The demuxer below removes those blocks so the browser gets plain audio, and reports each title.
// Nothing here stores or logs a title; the caller keeps the latest one in memory while the stream is open.

const MAX_TITLE_CHARS = 200;

/** The largest metaint a real server uses is 32768; anything outside 1..65536 is ignored (the audio is passed through untouched). */
export function usableMetaint(header: string | null): number | null {
  if (header === null || !/^\d{1,6}$/.test(header.trim())) return null;
  const value = Number(header);
  return value >= 1 && value <= 65_536 ? value : null;
}

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

/** The song text from one metadata block, or null when it has none (an empty title is the server saying "nothing to show"). */
export function parseStreamTitle(block: Uint8Array): string | null {
  const text = decode(block).replace(/\0+$/g, "");
  const match = /StreamTitle='(.*?)';(?:\s*StreamUrl=|\s*$)/s.exec(text) ?? /StreamTitle='(.*)$/s.exec(text);
  const title = (match?.[1] ?? "").replace(/\s+/g, " ").trim().replace(/';?$/, "").trim();
  return title === "" ? null : title.slice(0, MAX_TITLE_CHARS);
}

/** Splits a byte stream into audio and metadata blocks, chunk by chunk (a block may span chunks). */
export class IcyDemuxer {
  private mode: "audio" | "length" | "meta" = "audio";
  private audioLeft: number;
  private metaLeft = 0;
  private meta: number[] = [];

  constructor(private readonly metaint: number, private readonly onTitle: (title: string | null) => void) {
    this.audioLeft = metaint;
  }

  /** Feeds one chunk and returns the audio pieces in it, in order. */
  push(chunk: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    let at = 0;
    while (at < chunk.length) {
      if (this.mode === "audio") {
        const take = Math.min(this.audioLeft, chunk.length - at);
        out.push(chunk.subarray(at, at + take));
        at += take;
        this.audioLeft -= take;
        if (this.audioLeft === 0) this.mode = "length";
      } else if (this.mode === "length") {
        this.metaLeft = chunk[at]! * 16;
        at += 1;
        this.meta = [];
        if (this.metaLeft === 0) {
          this.mode = "audio";
          this.audioLeft = this.metaint;
        } else {
          this.mode = "meta";
        }
      } else {
        const take = Math.min(this.metaLeft, chunk.length - at);
        for (let i = 0; i < take; i++) this.meta.push(chunk[at + i]!);
        at += take;
        this.metaLeft -= take;
        if (this.metaLeft === 0) {
          this.onTitle(parseStreamTitle(Uint8Array.from(this.meta)));
          this.meta = [];
          this.mode = "audio";
          this.audioLeft = this.metaint;
        }
      }
    }
    return out;
  }
}
