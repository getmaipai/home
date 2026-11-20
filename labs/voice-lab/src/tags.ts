export const TAGS = ["laugh", "chuckle", "sigh", "gasp", "cough", "clear throat", "whisper", "shout", "excited", "happy", "angry", "sad", "sarcastic", "breath"] as const;
const known = new Set<string>(TAGS);
export type Segment = { type: "text"; value: string } | { type: "tag"; value: string };

export function splitTags(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /\[([^\]]*)\]/g;
  let at = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > at) out.push({ type: "text", value: text.slice(at, match.index) });
    const value = match[1]!.toLowerCase();
    if (known.has(value)) out.push({ type: "tag", value });
    else out.push({ type: "text", value: match[1]! });
    at = re.lastIndex;
  }
  if (at < text.length) out.push({ type: "text", value: text.slice(at) });
  return out;
}

export function forEngine(text: string, supportedTags: readonly string[]): string {
  const supported = new Set(supportedTags.map((tag) => tag.toLowerCase()));
  return splitTags(text).map((segment) => {
    if (segment.type === "text") return segment.value;
    return supported.has(segment.value) ? `[${segment.value}]` : "";
  }).join("");
}

export class TagStream {
  private pending = "";

  push(value: string): string {
    this.pending += value;
    const open = this.pending.lastIndexOf("[");
    if (open < 0) {
      const out = this.pending;
      this.pending = "";
      return out;
    }
    if (this.pending.indexOf("]", open) >= 0 || this.pending.length - open > 24) {
      const out = this.pending;
      this.pending = "";
      return out;
    }
    const out = this.pending.slice(0, open);
    this.pending = this.pending.slice(open);
    return out;
  }

  flush() {
    const out = this.pending;
    this.pending = "";
    return out;
  }
}
