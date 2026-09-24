// WRITTEN-PARITY-01 (docs/BACKLOG.md, the state record's "the reply
// floor"): whether the path's reply carries every point the bare
// model's own reply made to the same question, and keeps the same
// structure (lists, headings, steps) when the bare reply used one -
// never whether either reply is correct, and never style or tone
// (that is personaJudge.ts's own question, a different judge for a
// different axis). Same pattern as personaJudge.ts: one batched
// `response_format: json_schema` call over the whole set rather than
// one call per row.
import { complete, type LlmMessage } from "@/lib/llm";
import { visibleText } from "@/lib/wellFormed";

export interface ParityExchange {
  question: string;
  bareReply: string;
  pathReply: string;
}

export interface ParityVerdict {
  index: number;
  carries_points: boolean;
  missing_points: string[];
}

export interface ReplyParityJudgeResult {
  ok: true;
  verdicts: ParityVerdict[];
}

export interface ReplyParityJudgeFailure {
  ok: false;
  error: string;
}

const REPLY_PARITY_JUDGE_SCHEMA = {
  name: "reply_parity_judge",
  schema: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number" },
            carries_points: { type: "boolean" },
            missing_points: { type: "array", items: { type: "string" } },
          },
          required: ["index", "carries_points", "missing_points"],
        },
      },
    },
    required: ["verdicts"],
  },
} as const;

function buildJudgePrompt(exchanges: readonly ParityExchange[]): string {
  const transcript = exchanges
    .map((e, i) => `${i}. Question: "${e.question}"\n   Bare reply (the floor): "${e.bareReply}"\n   Path's reply: "${e.pathReply}"`)
    .join("\n");
  return (
    `You are grading whether a chat system's reply covers every point the bare model's own reply made to the ` +
    `same question, and keeps the same structure (lists, headings, steps) when the bare reply used one - never ` +
    `whether either reply is factually correct, and never its style or tone.\n\n` +
    `For each numbered exchange, decide whether the path's reply carries every point the bare reply made and ` +
    `matches its structure. When it does not, name each missing point in a few words.\n\n${transcript}\n\n` +
    `Return one verdict per exchange, indexed to match.`
  );
}

/** Judges a batch of already-generated bare/path reply pairs in a
 * single model call. Returns `ok: false` (never throws) on a malformed
 * judge reply or an unavailable backend - a bench calling this should
 * mark the batch "unjudged", not crash the whole run over one bad
 * call. */
export async function judgeReplyParity(exchanges: readonly ParityExchange[]): Promise<ReplyParityJudgeResult | ReplyParityJudgeFailure> {
  if (exchanges.length === 0) return { ok: true, verdicts: [] };

  const messages: LlmMessage[] = [{ role: "user", content: buildJudgePrompt(exchanges) }];
  const result = await complete("chat", messages, {
    temperature: 0.1,
    response_format: { type: "json_schema", json_schema: REPLY_PARITY_JUDGE_SCHEMA },
  });
  if (!result.ok) return { ok: false, error: result.error };

  try {
    // REASONING-01 (personaJudge.ts's own precedent): this call never
    // requests thinking, so visibleText() is a one-line defense against
    // a future change flipping that.
    const parsed = JSON.parse(visibleText(result.value.text)) as { verdicts?: unknown };
    if (!Array.isArray(parsed.verdicts)) return { ok: false, error: "judge reply had no verdicts array" };
    // Indexed by exchange index, kept in a Map the same way
    // personaJudge.ts's own parse does - a skipped or repeated index
    // never silently shrinks or misaligns the result set.
    const byIndex = new Map<number, ParityVerdict>();
    for (const raw of parsed.verdicts) {
      if (!raw || typeof raw !== "object") continue;
      const v = raw as Record<string, unknown>;
      if (typeof v.index !== "number" || typeof v.carries_points !== "boolean") continue;
      if (v.index < 0 || v.index >= exchanges.length || !Number.isInteger(v.index)) continue;
      const missing = Array.isArray(v.missing_points) ? v.missing_points.filter((p): p is string => typeof p === "string") : [];
      byIndex.set(v.index, { index: v.index, carries_points: v.carries_points, missing_points: missing });
    }
    if (byIndex.size === 0) return { ok: false, error: "judge reply parsed but produced no usable verdicts" };
    const verdicts = [...byIndex.values()].sort((a, b) => a.index - b.index);
    return { ok: true, verdicts };
  } catch {
    return { ok: false, error: "judge reply was not valid JSON" };
  }
}
