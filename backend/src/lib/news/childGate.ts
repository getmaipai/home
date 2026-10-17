// NEWS-02 (news note section 11 and 15, kid-mode note 9.5, rule 10): a child's every headline, dek, source line and article
// sentence passes the output floor on the hub, one sentence at a time, before it is shown or spoken. The gate is the same floor
// a spoken turn uses (evaluateSafety read through forOutput, the identical detectors and categories), applied here to News
// text built on the hub. A sentence that fails is dropped from both the page and the audio; the rest stay. No client ever holds
// an ungated sentence, and no client assembles speech from other fields.
//
// Only a child's text goes through this (a teen's and an adult's strings meet the same floor whole, in filterAnswerBlocks).
import { splitReadyChunks } from "@maipai/spec/safety/ts/sentenceChunker.js";
import type { AgeBand } from "@/lib/ageBand";
import { evaluateSafety, forOutput } from "@/lib/safety";
import type { ArticleBlock, ArticleInline } from "@/lib/retrieval/extractArticle";
import { bumpNewsCounter } from "./newsCounters";

export interface Gate {
  /** The text with every sentence that fails the floor left out ("" when nothing is left). */
  text(value: string): string;
  /** Whether a short string (a headline, a source line) passes whole. */
  passes(value: string): boolean;
}

/** The sentences of a text, in order (the same chunker the spoken gate cuts with); a tail with no terminator is a sentence. */
export function sentencesOf(value: string): string[] {
  const { chunks, consumed } = splitReadyChunks(value, false);
  const tail = value.slice(consumed).trim();
  return tail ? [...chunks, tail] : chunks;
}

/** A gate for this person. A band that is not child gets a pass-through (its strings meet the floor whole at release). */
export function gateFor(band: AgeBand): Gate {
  if (band !== "child") return { text: (value) => value, passes: () => true };
  // No parent notification here: the child asked for nothing the publisher wrote, so a dropped sentence is not the child's
  // activity to report (the classifier still logs the category, never the text).
  const refuses = (sentence: string): boolean => forOutput(evaluateSafety(sentence, band)).action === "refuse";
  return {
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
      return text ? { ...block, text } : null;
    }
    case "paragraph":
    case "quote": {
      const inlines = rebuild(block.inlines);
      return inlines ? { ...block, inlines } : null;
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

export const SPEECH_CHUNK_MAX = 4000;

/** What Listen speaks: the headline first, then the body, cut into chunks of at most 4,000 characters at paragraph
 * boundaries (a single paragraph longer than that is cut at a sentence). Built from the same blocks the page shows, so a
 * sentence the gate dropped is in neither. */
export function speechFor(title: string, blocks: readonly ArticleBlock[]): string[] {
  const units = [title, ...blocks.flatMap(speakableUnits)].map((unit) => unit.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const push = (piece: string): void => {
    if (current && current.length + 2 + piece.length > SPEECH_CHUNK_MAX) { chunks.push(current); current = ""; }
    current = current ? `${current}\n\n${piece}` : piece;
  };
  for (const unit of units) {
    if (unit.length <= SPEECH_CHUNK_MAX) { push(unit); continue; }
    let piece = "";
    for (const sentence of sentencesOf(unit)) {
      if (piece && piece.length + 1 + sentence.length > SPEECH_CHUNK_MAX) { push(piece); piece = ""; }
      piece = piece ? `${piece} ${sentence}` : sentence.slice(0, SPEECH_CHUNK_MAX);
    }
    if (piece) push(piece);
  }
  if (current) chunks.push(current);
  return chunks;
}
