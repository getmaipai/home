// OUT-01 (dev.md, "The chat design pass", section 2): the well-formed
// reply rule, one definition for every producer of a reply. The model
// cannot be asked not to stop early; the engine is the only party that
// sees the end of stream, so the rule lives at the boundary that
// already owns safety and guards (finalizeReply in turnEngine.ts), on
// the streaming path's first chunk and final span, and on every bench
// row as a measured number. No store behind it: the bench's scorer and
// the guards read it too.
import { SHORT_ANSWERS } from "@/lib/consentVocab";

export type MalformedReason = "empty" | "control" | "unbalanced" | "fragment";

/** The markers a chat template leaks when a model runs past its own
 * turn: never part of a reply. */
// Not the think tags: a think block travels intact in reply.text by
// the pipeline's contract and the frontend strips the whole block
// (chatModelAdapter.ts, #20); stripping the tags alone would serve the
// reasoning as the reply.
const CONTROL_MARKER_RE = /<\|[^|>]{0,32}\|>|<\/?s>|\[\/?INST\]|<<\/?SYS>>|<\/?tool_call>|\x00/gi;
const HAS_CONTROL_MARKER_RE = new RegExp(CONTROL_MARKER_RE.source, "i");
/** A sentence's end: a stop, optionally closed by quotes or brackets;
 * or a symbol that is not a letter, a digit, a quote, a bracket or a
 * connector (an emoji, an emoticon's face, a code fence), which ends a
 * casual line on its own and takes no stop after it. */
// An emoji with what may follow it: a variation selector, a skin tone,
// a keycap, or a flag's second regional indicator.
const TERMINATOR_RE = /(?:[.!?…][)\]"'”’]*|[:;]-?[()DPp]|\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}]|\u20E3|\p{Regional_Indicator})*|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|`)\s*$/u;
const PICTOGRAPH_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3/u;
const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>\s*/gi;
const OPEN_THINK_RE = /<think>[\s\S]*$/i;

/** The reply as the person sees it: a think block (closed, or open at
 * the end when a cap cut it) is the model's reasoning, stripped whole
 * by the frontend (chatModelAdapter.ts, #20) and never judged here. */
export function visibleText(text: string): string {
  return text.replace(THINK_BLOCK_RE, "").replace(OPEN_THINK_RE, "");
}

/** The think blocks a reply carries, verbatim, to travel with the
 * repaired visible text. */
export function thinkingPrefix(text: string): string {
  const closed = text.match(THINK_BLOCK_RE)?.join("") ?? "";
  const open = text.replace(THINK_BLOCK_RE, "").match(OPEN_THINK_RE)?.[0] ?? "";
  return `${closed}${open}`;
}

/** REASONING-01: one span of a stream, split on `<think>`/`</think>`
 * boundaries - `reasoning: true` for a think block's own content (tags
 * stripped), `reasoning: false` for everything else, in the order it
 * appeared. */
export interface ThinkSpan { reasoning: boolean; text: string; }

/** Carries `feedThinkSplit()`'s state across chunks of one stream:
 * `inThink` mirrors turnEngine.ts's own `holdForLookup()` state machine
 * (the identical two tag tests), so this agrees with every internal
 * `<think>` detection the pipeline already does; `buffer` holds back
 * whatever COULD be the start of a split tag until the next chunk
 * resolves it (see feedThinkSplit()'s own comment); `skippingCloseWhitespace`
 * is set the instant a close tag is found, so the whitespace THINK_BLOCK_RE's
 * own `\s*` already consumes right after `</think>` (a code review caught
 * this splitter not matching that: a live-streamed reply could show a
 * stray leading blank line the stored/final text never has) is discarded
 * here too, never emitted as its own leading-whitespace visible span. */
export interface ThinkSplitState { inThink: boolean; buffer: string; skippingCloseWhitespace: boolean; }
export function newThinkSplitState(): ThinkSplitState {
  return { inThink: false, buffer: "", skippingCloseWhitespace: false };
}

// Whether the buffer's own TAIL could be the start of `tag` (case-
// insensitive) - the longest such overlap, or 0 if none of the buffer's
// trailing characters could possibly begin it. Checked against ONLY the
// tag relevant to the current state (`</think>` while inThink, `<think>`
// otherwise): a real chunk boundary is a token boundary, never a
// semantic one, so a tag can legitimately split across two raw deltas
// (the same live possibility holdForLookup()'s own accumulate-until-
// resolved buffer already lives with) - checking the wrong tag here
// would hold back characters that could never complete anything.
function partialTagOverlapLength(buffer: string, tag: string): number {
  const maxLen = Math.min(buffer.length, tag.length - 1);
  for (let len = maxLen; len > 0; len--) {
    if (tag.toLowerCase().startsWith(buffer.slice(buffer.length - len).toLowerCase())) return len;
  }
  return 0;
}

/** Feeds one more raw chunk into the splitter, returning zero or more
 * ready-to-emit spans - PROGRESSIVELY, as reasoning or visible text
 * accumulates, never waiting for a block's own close tag to arrive
 * before yielding anything (the whole point of streaming reasoning "as
 * it arrives," the contract table's own words). Only the trailing
 * handful of characters that could genuinely be the start of the tag
 * currently being watched for are ever held back, resolved by whatever
 * the next chunk brings. REASONING-01's own wire-boundary split
 * (routes/turn.ts's streamTurnEvents()) is this function's one caller;
 * nothing upstream (turnEngine.ts, wellFormed.ts's own other functions)
 * changes - those functions receive the pipeline's combined text exactly
 * as they always have. */
export function feedThinkSplit(state: ThinkSplitState, chunk: string): ThinkSpan[] {
  state.buffer += chunk;
  const spans: ThinkSpan[] = [];
  for (;;) {
    if (state.skippingCloseWhitespace) {
      const stripped = state.buffer.replace(/^\s+/, "");
      if (stripped.length === 0) {
        // Fully whitespace so far (or genuinely empty) - hold: more
        // whitespace, or the first real visible character, may still be
        // coming, and either way nothing is ready to emit yet.
        state.buffer = "";
        break;
      }
      state.buffer = stripped;
      state.skippingCloseWhitespace = false;
    }
    if (state.inThink) {
      const close = /<\/think>/i.exec(state.buffer);
      if (close) {
        const text = state.buffer.slice(0, close.index);
        if (text) spans.push({ reasoning: true, text });
        state.buffer = state.buffer.slice(close.index + close[0].length);
        state.inThink = false;
        state.skippingCloseWhitespace = true;
        continue;
      }
      const holdBack = partialTagOverlapLength(state.buffer, "</think>");
      const safe = state.buffer.length - holdBack;
      if (safe > 0) {
        spans.push({ reasoning: true, text: state.buffer.slice(0, safe) });
        state.buffer = state.buffer.slice(safe);
      }
      break;
    }
    const open = /<think>/i.exec(state.buffer);
    if (open) {
      if (open.index > 0) spans.push({ reasoning: false, text: state.buffer.slice(0, open.index) });
      state.buffer = state.buffer.slice(open.index + open[0].length);
      state.inThink = true;
      continue;
    }
    const holdBack = partialTagOverlapLength(state.buffer, "<think>");
    const safe = state.buffer.length - holdBack;
    if (safe > 0) {
      spans.push({ reasoning: false, text: state.buffer.slice(0, safe) });
      state.buffer = state.buffer.slice(safe);
    }
    break;
  }
  return spans;
}

/** Whatever's left once the stream itself ends - a truncated open think
 * block (never closed: the same "generation cut off mid-reasoning" shape
 * OPEN_THINK_RE already treats as a real, expected case), or the last
 * few held-back characters of ordinary visible text that were never a
 * tag after all. */
export function flushThinkSplit(state: ThinkSplitState): ThinkSpan[] {
  // Whatever's left is trailing whitespace right after a close tag with
  // nothing visible ever following (an empty reply after reasoning) -
  // discarded, the same as THINK_BLOCK_RE's own `\s*` would discard it
  // from the stored/final text, never emitted as a visible span.
  if (state.skippingCloseWhitespace) {
    state.buffer = "";
    state.skippingCloseWhitespace = false;
    return [];
  }
  if (!state.buffer) return [];
  const span: ThinkSpan = { reasoning: state.inThink, text: state.buffer };
  state.buffer = "";
  return [span];
}

/** REASONING-02: the same reasoning text a live `reasoning` wire event
 * would have carried for this exact text, in one pass - for a caller
 * that has a whole completed (or buffered-so-far) string in hand rather
 * than a token stream, e.g. turnEngine.ts's peekAndHandle()/runTurn()
 * attaching TurnValue.reasoning when a tool call resolves before any
 * close tag ever streamed (an open, unclosed think block -
 * flushThinkSplit()'s truncated-block case). Returns undefined for no
 * reasoning at all, matching the field's own optionality. */
export function extractReasoningText(text: string): string | undefined {
  const state = newThinkSplitState();
  const spans = [...feedThinkSplit(state, text), ...flushThinkSplit(state)];
  const reasoning = spans.filter((span) => span.reasoning).map((span) => span.text).join("");
  return reasoning || undefined;
}

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
/** A malformed output this long or shorter earns one regeneration; a
 * longer one is repaired in place (a long reply with a dangling
 * connector is a reply, not a fragment), so one slow generation never
 * becomes two (the reconciled review's bound). */
export const SHORT_MALFORMED_CHARS = 60;
/** The regeneration's token cap: a short reply's worth. At the cap the
 * deterministic repair is emitted, never a third try. */
export const RETRY_TOKEN_CAP = 48;

/** The words a lone token is made of when a model stops after its
 * first one: never an answer on their own. */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "i", "the", "a", "an", "and", "but", "or", "so", "to", "of", "in", "on", "it", "is", "are", "was", "were", "that", "this", "with", "for", "as", "at", "by", "if", "then", "well", "um", "uh", "hmm", "you", "we", "they", "he", "she", "my", "your", "its", "not", "just", "also", "very", "let", "here",
]);

function words(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

/** Closes a clause left dangling on a connector ("...on publications,"
 * becomes "...on publications.") and nothing else; a text that already
 * ends in a terminator, or in no connector at all, passes through.
 * Jesse, live-found 2026-09-07 on a guard cut mid-clause; a code review
 * found the first cut stripping one character of a doubled dash. */
export function closeDanglingClause(text: string): string {
  const trimmed = text.trimEnd();
  const stripped = trimmed.replace(/\s*[,;:\-–—]+$/, "");
  return stripped === trimmed ? text : `${stripped}.`;
}

/** The deterministic repair, applied before the rule is judged and
 * again to whatever the rule accepts: control markers out; an unmatched
 * quotation mark at either edge stripped and a reply that is one whole
 * quoted sentence unquoted (interior quotes stand); an unmatched
 * bracket at the edge stripped; a dangling connector closed; a reply
 * of two words or more that simply stopped given its full stop. Pure
 * and idempotent. */
export function repairReply(text: string): string {
  const thinking = thinkingPrefix(text);
  const visible = repairVisible(visibleText(text).replace(CONTROL_MARKER_RE, ""));
  return thinking ? `${thinking}${visible}` : visible;
}

const QUOTE_CHARS = new Set(['"', "“", "”"]);
/** The quotation marks that are ones, as UTF-16 indexes (every index
 * here is UTF-16, since the text is sliced by them): a straight mark
 * after a digit is an inch mark, unless a quote is open before it
 * ("Press "1" to confirm" closes one). */
function quoteIndexes(t: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (!QUOTE_CHARS.has(t[i]!)) continue;
    if (t[i] === '"' && /\d/.test(t[i - 1] ?? "") && out.length % 2 === 0) continue;
    out.push(i);
  }
  return out;
}
function isOpenParenAt(t: string, i: number): boolean {
  return t[i] === "(" && !/[:;\-]/.test(t[i - 1] ?? "");
}
/** The parentheses that are unmatched, scanned in order: an opener
 * with no closer, and a closer with no opener before it that is not an
 * emoticon's face or a list marker's "1)" (a closer after a letter or
 * digit closes an open one when there is one). */
function strayParens(t: string): { opens: number[]; closes: number[] } {
  const openStack: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (isOpenParenAt(t, i)) openStack.push(i);
    else if (t[i] === ")") {
      if (/[:;\-]/.test(t[i - 1] ?? "")) continue; // an emoticon's face
      if (openStack.length > 0) openStack.pop();
      else if (!/[\p{L}\p{N}]/u.test(t[i - 1] ?? "")) closes.push(i); // a list marker's "1)" is not stray
    }
  }
  return { opens: openStack, closes };
}
function strayBrackets(t: string): { opens: number[]; closes: number[] } {
  const openStack: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "[") openStack.push(i);
    else if (t[i] === "]") {
      if (openStack.length > 0) openStack.pop();
      else closes.push(i);
    }
  }
  return { opens: openStack, closes };
}

function repairVisible(input: string): string {
  let t = input.trim();
  if (!t) return "";
  // Double quotation marks, straight and curly as one family (a curly
  // opener closed straight is one pair): an odd count means one is
  // stray; at an edge it is dropped, a whole quoted sentence is
  // unquoted, and an interior stray one is removed so a long reply is
  // repaired in place rather than discarded. An apostrophe is a
  // contraction more often than a quote and is never touched.
  let q = quoteIndexes(t);
  // The stray is the last one (a model runs out mid-quote), unless it
  // is the only one; judged again after the strip, since dropping a
  // mark can turn an inch mark into a quote.
  for (let guard = 0; guard < 3 && q.length % 2 === 1; guard++) {
    const at = q.length === 1 ? q[0]! : q[q.length - 1]!;
    t = (t.slice(0, at) + t.slice(at + 1)).replace(/\s+([.,!?])/g, "$1").trim();
    q = quoteIndexes(t);
  }
  if (q.length === 2 && q[0] === 0 && q[1] === t.length - 1 && t.length > 2) t = t.slice(1, -1).trim();
  // Brackets: an unmatched opener at the end or the start is dropped,
  // an unmatched closer at the end likewise, and an interior stray one
  // removed; an emoticon's face and a list marker's "1)" are not
  // brackets.
  for (const scan of [strayParens, strayBrackets]) {
    const stray = scan(t);
    const drop = new Set([...stray.opens, ...stray.closes]);
    if (drop.size > 0) {
      let kept = "";
      for (let i = 0; i < t.length; i++) if (!drop.has(i)) kept += t[i];
      t = kept.replace(/\s+([.,!?])/g, "$1").trim();
    }
  }
  t = closeDanglingClause(t).trim();
  const ws = words(t);
  if (t && !TERMINATOR_RE.test(t) && (ws.length >= 2 || (ws.length === 1 && !FUNCTION_WORDS.has(ws[0]!.toLowerCase())))) t = `${t}.`;
  return t;
}

/** Unbalanced marks, judged on the text with the marks that are not
 * quotes or brackets taken out first: an inch mark after a digit (5"),
 * an emoticon (:) ;) :( ), and a list marker's closing bracket ("1) go
 * now 2) wait") that has no opener anywhere before it. A review found
 * the plain count calling all three broken. */
function unbalanced(t: string): boolean {
  const quotes = quoteIndexes(t).length;
  const p = strayParens(t);
  const b = strayBrackets(t);
  return quotes % 2 === 1 || p.opens.length > 0 || p.closes.length > 0 || b.opens.length > 0 || b.closes.length > 0;
}

/** Why a reply fails the rule, or null when it stands: empty; a control
 * marker; unbalanced quotation marks or brackets; a fragment (no
 * terminator, or one word that is not on the short-answer list). Judged
 * on the text as it would be sent, so run it on repairReply()'s result. */
export function assessReply(text: string): MalformedReason | null {
  const t = visibleText(text).trim();
  if (!t) return "empty";
  if (HAS_CONTROL_MARKER_RE.test(t)) return "control";
  if (unbalanced(t)) return "unbalanced";
  const ws = words(t);
  // An emoji alone is a reaction, a whole reply on a casual turn.
  if (ws.length === 0 && PICTOGRAPH_RE.test(t)) return null;
  if (ws.length === 0) return "fragment";
  if (!TERMINATOR_RE.test(t)) return "fragment";
  // One word with its stop is an answer ("Paris.", "Done.", "Yes.")
  // unless the word is a function word, which is a stop put on a
  // fragment ("I.", "The."); the short-answer list covers the words a
  // reply is made of on its own without a stop (the repair adds it).
  if (ws.length === 1 && FUNCTION_WORDS.has(ws[0]!.toLowerCase()) && !SHORT_ANSWERS.has(ws[0]!.toLowerCase())) return "fragment";
  return null;
}

/** The bench's universal check and the boundary's own test: the reply
 * as sent passes the rule. */
export function isWellFormed(text: string): boolean {
  return assessReply(text) === null;
}

/** Whether a malformed output is short enough to regenerate once; a
 * longer one is repaired in place. */
export function isShortMalformed(text: string): boolean {
  return visibleText(text).trim().length <= SHORT_MALFORMED_CHARS;
}

/** The streaming path's final buffered span (whatever the model's
 * generation left after its last sentence boundary), repaired against
 * what was already delivered rather than emitted raw: an unmatched
 * closing quotation mark judged over the whole reply, a dangling
 * connector closed, a stop added to a clause that simply stopped. The
 * delivered text itself is on the wire and cannot change. */
export function repairTail(delivered: string, tail: string): string {
  const t = tail.replace(CONTROL_MARKER_RE, "");
  const lead = t.match(/^\s*/)?.[0] ?? "";
  let body = t.trim();
  if (!body || !visibleText(body).trim()) return t; // nothing visible to repair (a think block alone)
  // Judged on what the person sees: a think block in the delivered
  // text is not part of the reply's quotation marks.
  const whole = `${visibleText(delivered)}${visibleText(body)}`;
  const quotes = quoteIndexes(whole).length;
  if (quotes % 2 === 1 && QUOTE_CHARS.has(body[body.length - 1]!)) body = body.slice(0, -1).trimEnd();
  body = closeDanglingClause(body).trimEnd();
  if (body && !TERMINATOR_RE.test(body) && words(body).length >= 1) body = `${body}.`;
  return `${lead}${body}`;
}
