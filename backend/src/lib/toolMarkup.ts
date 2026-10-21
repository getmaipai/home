// RECENCY-02: tool-call markup is never shown to a person. A model sometimes writes its own tool call as text after
// some prose (Qwen3.6, live 2026-10-21: "... <tool_call> <function=generate_image> <parameter=prompt> ... </parameter>
// </function> </tool_call>") when the engine's parser did not turn it into a real call. That text is a wire shape,
// not an answer: it is cut off wherever it starts, whatever follows it is dropped with it, and the prose before it is
// the reply. Whether the call may run is not decided here: a call written inside prose never runs.

/** The openings of a tool call written as text, in the formats the models in the catalog use. Case-insensitive. */
const MARKUP_START = /<tool_call\b|<function=|<function_call\b|<parameter=|<\|tool_call|<\|python_tag\|>|\[TOOL_CALLS\]/i;
/** A JSON envelope ({"name": ..., "arguments": ...}) that follows prose. Only read when the whole text is known. */
const JSON_ENVELOPE_START = /\{\s*"name"\s*:\s*"[\w.-]+"\s*,\s*"arguments"\s*:/;

const MARKERS = ["<tool_call", "<function=", "<function_call", "<parameter=", "<|tool_call", "<|python_tag|>", "[tool_calls]"];

/** Whether `index` sits inside a fenced code block or an inline code span of `text` (an answer that SHOWS tool-call syntax
 * is an answer, not a call). An unclosed fence counts as open: the stream has not reached its end yet. */
function insideCode(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const fences = (before.match(/```/g) ?? []).length;
  if (fences % 2 === 1) return true;
  const lineStart = before.lastIndexOf("\n") + 1;
  return (before.slice(lineStart).match(/`/g) ?? []).length % 2 === 1;
}

/** Where tool-call markup starts in a stream so far, or -1. Markup inside code is not markup. */
export function toolMarkupStart(text: string): number {
  const all = new RegExp(MARKUP_START.source, "gi");
  for (let m = all.exec(text); m; m = all.exec(text)) if (!insideCode(text, m.index)) return m.index;
  return -1;
}

/** How many characters at the end of `text` could be the beginning of a marker that has not fully arrived ("<tool_c").
 * A stream holds that many back until the next piece decides whether they are markup. */
export function markerPrefixTail(text: string): number {
  const lower = text.toLowerCase();
  let longest = 0;
  for (const marker of MARKERS) {
    const max = Math.min(marker.length - 1, lower.length);
    for (let length = max; length > longest; length -= 1) {
      if (lower.endsWith(marker.slice(0, length))) { longest = length; break; }
    }
  }
  return longest;
}

export interface StrippedMarkup {
  /** The reply without the markup, trimmed at the end. */
  text: string;
  /** What was cut off, verbatim (empty when there was none). */
  markup: string;
}

/** The reply with any tool-call markup removed from the first opening to the end. */
export function stripToolMarkup(text: string): StrippedMarkup {
  const tag = toolMarkupStart(text);
  const jsonAt = text.search(JSON_ENVELOPE_START);
  const json = jsonAt >= 0 && !insideCode(text, jsonAt) ? jsonAt : -1;
  const starts = [tag, json].filter((index) => index >= 0);
  if (starts.length === 0) return { text, markup: "" };
  const at = Math.min(...starts);
  return { text: text.slice(0, at).trimEnd(), markup: text.slice(at) };
}
