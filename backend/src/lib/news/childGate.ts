// NEWS-02 (news note section 11 and 15, kid-mode note 9.5, rule 10): a child's every headline, dek, source line and article
// sentence passes the output floor on the hub, one sentence at a time, before it is shown or spoken. The gate is the same floor
// a spoken turn uses (evaluateSafety read through forOutput, the identical detectors and categories), applied here to News
// text built on the hub. A sentence that fails is dropped from both the page and the audio; the rest stay. No client ever holds
// an ungated sentence, and no client assembles speech from other fields.
//
// Only a child's text goes through this (a teen's and an adult's strings meet the same floor whole, in filterAnswerBlocks).
import { splitReadyChunks } from "@maipai/spec/safety/ts/sentenceChunker.js";
import type { AgeBand } from "@/lib/ageBand";
import { carriesCrisisSignal, evaluateSafety, forOutput } from "@/lib/safety";
import type { ArticleBlock, ArticleInline } from "@/lib/retrieval/extractArticle";
import { bumpNewsCounter } from "./newsCounters";

export interface Gate {
  /** The text with every sentence that fails the floor left out ("" when nothing is left). */
  text(value: string): string;
  /** Whether a short string (a headline, a source line) passes whole. */
  passes(value: string): boolean;
  /** True once a sentence about self-harm or a crisis was seen. News is not a conversation, so no resources are offered: the caller drops the whole article. */
  sawCrisis(): boolean;
}

/** The sentences of a text, in order (the same chunker the spoken gate cuts with); a tail with no terminator is a sentence. */
export function sentencesOf(value: string): string[] {
  const { chunks, consumed } = splitReadyChunks(value, false);
  const tail = value.slice(consumed).trim();
  return tail ? [...chunks, tail] : chunks;
}

/** A gate for this person. A band that is not child gets a pass-through (its strings meet the floor whole at release). */
export function gateFor(band: AgeBand): Gate {
  if (band !== "child") return { text: (value) => value, passes: () => true, sawCrisis: () => false };
  // No parent notification here: the child asked for nothing the publisher wrote, so a dropped sentence is not the child's
  // activity to report (the classifier still logs the category, never the text).
  let crisis = false;
  const refuses = (sentence: string): boolean => {
    const safety = forOutput(evaluateSafety(sentence, band));
    if (carriesCrisisSignal(safety)) { crisis = true; return true; }
    return safety.action === "refuse";
  };
  return {
    sawCrisis: () => crisis,
    text(value) {
      const kept: string[] = [];
      for (const sentence of sentencesOf(value)) {
        if (refuses(sentence)) bumpNewsCounter("story_gate_dropped");
        else kept.push(sentence);
      }
      return kept.join(" ").trim();
    },
    passes(value) {
      const ok = value.trim() === "" || !refuses(value);
      if (!ok) bumpNewsCounter("story_gate_dropped");
      return ok;
    },
  };
}

// ---- Article blocks and speech ---------------------------------------------------------------

export function inlineText(inlines: readonly ArticleInline[]): string {
  return inlines.map((inline) => inline.text).join(" ").replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ").trim();
}

function slugOf(text: string, fallback: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback.replace(/[^a-z0-9-]+/gi, "").slice(0, 8) || "section";
}

const plainInline = (text: string): ArticleInline[] => [{ type: "text", text }];

/** A block with a child's gate applied: kept whole when every sentence passes, rebuilt from the sentences that did when some
 * failed (emphasis in a rebuilt run is lost), dropped when nothing is left. Null when the block is dropped. */
export function gateBlock(block: ArticleBlock, gate: Gate): ArticleBlock | null {
  const rebuild = (inlines: readonly ArticleInline[]): ArticleInline[] | null => {
    const original = inlineText(inlines);
    const kept = gate.text(original);
    if (kept === "") return null;
    return kept === original ? [...inlines] : plainInline(kept);
  };
  switch (block.type) {
    case "heading": {
      const text = gate.text(block.text);
      // The id is built from the text that stays: a dropped sentence must not live on in the anchor.
      return text ? { ...block, text, id: text === block.text ? block.id : slugOf(text, block.id) } : null;
    }
    case "paragraph": {
      const inlines = rebuild(block.inlines);
      return inlines ? { ...block, inlines } : null;
    }
    case "quote": {
      const inlines = rebuild(block.inlines);
      if (!inlines) return null;
      const cite = block.cite === undefined ? undefined : gate.text(block.cite);
      const { cite: _old, ...rest } = block;
      return { ...rest, inlines, ...(cite ? { cite } : {}) };
    }
    case "list": {
      const items = block.items.map(rebuild).filter((item): item is ArticleInline[] => item !== null);
      return items.length > 0 ? { ...block, items } : null;
    }
    case "rows": {
      const rows = block.rows.map((row) => ({ label: gate.text(row.label), value: gate.text(row.value) })).filter((row) => row.label && row.value);
      return rows.length > 0 ? { ...block, rows } : null;
    }
    case "table": {
      const headers = block.headers.map((cell) => gate.text(cell));
      const rows = block.rows.map((row) => row.map((cell) => gate.text(cell)));
      return headers.some(Boolean) || rows.some((row) => row.some(Boolean)) ? { ...block, headers, rows } : null;
    }
    case "figure":
      return null; // a News body holds no figures (pictures come through the picture route only)
    case "note": {
      const text = gate.text(block.text);
      return text ? { ...block, text } : null;
    }
  }
}

export function gateBlocks(blocks: readonly ArticleBlock[], gate: Gate): ArticleBlock[] {
  return blocks.map((block) => gateBlock(block, gate)).filter((block): block is ArticleBlock => block !== null);
}

/** The words of a block, one string per paragraph-like unit, for Listen. Photo credits and timestamps are never in the block list. */
function speakableUnits(block: ArticleBlock): string[] {
  switch (block.type) {
    case "heading": return [block.text];
    case "paragraph":
    case "quote": return [inlineText(block.inlines)];
    case "list": return block.items.map(inlineText);
    case "rows": return block.rows.map((row) => `${row.label}: ${row.value}`);
    case "note": return [block.text];
    default: return []; // tables and figures are not read aloud
  }
}

/** Listen speaks one chunk at a time and the voice makes a chunk in about 0.6 of the time it takes to say it (measured 2026-10-31: 450
 * characters, 24 s of speech, 15 s to make). The next chunk is made while the current one plays, so it must not be much longer than the
 * one playing, or the bar sits silent between them (issue 260: a headline of 2 s, then a 900-character chunk that took 35 s to arrive,
 * heard as "only the headline is read"). So the first chunk is the headline plus a short lead, and each chunk may be up to 1.5 times the
 * length of the one before it, until SPEECH_CHUNK_MAX. */
export const SPEECH_CHUNK_MAX = 900;
export const SPEECH_FIRST_CHUNK_MAX = 200;
export const SPEECH_CHUNK_GROWTH = 1.5;

/** What Listen speaks: the headline and a short lead first, then the body in chunks that grow (short paragraphs share a chunk; a longer
 * paragraph is cut at sentences, a longer sentence at a word). Built from the same blocks the page shows, so a sentence the gate dropped
 * is in neither. */
export function speechFor(title: string, blocks: readonly ArticleBlock[]): string[] {
  const units = [title, ...blocks.flatMap(speakableUnits)].map((unit) => unit.trim()).filter(Boolean);
  const headline = units[0] ?? "";
  const chunks: string[] = [];
  let current = "";
  // The room the chunk being filled has: 1.5 times the one before it (never less than the first chunk's, never more than the maximum).
  const limit = (): number => {
    const before = chunks[chunks.length - 1];
    return before === undefined ? SPEECH_FIRST_CHUNK_MAX : Math.max(SPEECH_FIRST_CHUNK_MAX, Math.min(SPEECH_CHUNK_MAX, Math.floor(before.length * SPEECH_CHUNK_GROWTH)));
  };
  // A single sentence longer than the limit is cut at a space, never dropped.
  const wordsCut = (sentence: string, max: number): string[] => {
    const cuts: string[] = [];
    let rest = sentence;
    while (rest.length > max) {
      const at = rest.lastIndexOf(" ", max);
      const end = at > 0 ? at : max;
      cuts.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    if (rest) cuts.push(rest);
    return cuts;
  };
  // Sentences fill each chunk up to its room; a paragraph break is kept as a blank line inside a chunk. The headline is never alone:
  // the first sentence of the body always joins it, however long the headline is.
  const add = (piece: string, separator: string): void => {
    const headlineOnly = chunks.length === 0 && current === headline;
    if (current && !headlineOnly && current.length + separator.length + piece.length > limit()) { chunks.push(current); current = piece; return; }
    current = current ? `${current}${separator}${piece}` : piece;
  };
  units.forEach((unit, index) => {
    if (index === 0) { current = unit; return; }
    const pending = sentencesOf(unit);
    let first = true;
    while (pending.length > 0) {
      const sentence = pending.shift()!;
      if (sentence.length > limit()) { pending.unshift(...wordsCut(sentence, limit())); continue; }
      add(sentence, first ? "\n\n" : " ");
      first = false;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}
