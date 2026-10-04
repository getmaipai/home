// SMOKE-CHAT-01: the pure verdict logic of the chat smoke test, split from
// chat.ts so tests/chatSmokeChecks.test.ts can import it without starting
// anything. Checks are deliberately simple: a person reads the replies;
// this only catches the failures a reply can show on its face.

/** Sentences Home must never show as an answer: the stored fallbacks of a
 * failed compose (composer.ts COMPOSE_FAILURE_LINE, replyVariation.ts) and
 * the offline companion line (stackEngine.ts OFFLINE_COMPANION_LINE, which
 * the spoken variant extends with a trailing sentence). */
export const STATIC_FAILURE_LINES = ["Sorry, I couldn't do that.", "I can't think right now."] as const;

export function isStaticFailureLine(text: string): boolean {
  const trimmed = text.trim();
  return STATIC_FAILURE_LINES.some((line) => trimmed.startsWith(line));
}

/** True when a reply opens with the history wrapper the model must never
 * imitate, such as `[Web Search answered: "..."]` (conversationHistory.ts
 * writes it for earlier package turns; turnNext.ts guards against the
 * model copying it). */
export function hasBracketWrapper(text: string): boolean {
  return /^\s*\[[^\]\n]{1,80}?\banswered:/i.test(text);
}

export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

export interface TurnSpec {
  id: string;
  person: "adult" | "child";
  text: string;
  spoken?: boolean;
  /** Continue the previous turn's conversation (a follow-up). */
  followUp?: boolean;
  /** The model decides; when it does not search this is a WARN, never a FAIL. */
  expectSearch?: boolean;
  /** FAIL when the reply has more words than this (a child or spoken cap). */
  maxWords?: number;
  /** WARN when the reply has fewer words than this (a long-answer turn). */
  minWords?: number;
}

export interface TurnObservation {
  httpStatus: number;
  reply: string;
  firstDeltaMs: number | null;
  totalMs: number;
  /** The package or tool that answered, null when the model answered alone. */
  tool: string | null;
  sources: number;
  /** The failure kind: an error event's code or text, or a non-200 status. */
  failure: string | null;
}

export type Verdict = "PASS" | "WARN" | "FAIL";
export interface TurnVerdict {
  verdict: Verdict;
  fails: string[];
  warns: string[];
}

export function judgeTurn(spec: TurnSpec, seen: TurnObservation): TurnVerdict {
  const fails: string[] = [];
  const warns: string[] = [];
  const words = wordCount(seen.reply);
  if (seen.failure) fails.push(`failure: ${seen.failure}`);
  if (words === 0) fails.push("reply is empty");
  if (isStaticFailureLine(seen.reply)) fails.push("reply is a static failure sentence");
  if (hasBracketWrapper(seen.reply)) fails.push("reply starts with a bracketed 'answered:' wrapper");
  if (seen.tool === "websearch" && seen.sources === 0) fails.push("a search turn returned no sources");
  if (spec.maxWords !== undefined && words > spec.maxWords) fails.push(`reply is ${words} words, over the ${spec.maxWords}-word cap`);
  if (spec.minWords !== undefined && words > 0 && words < spec.minWords) warns.push(`reply is only ${words} words, under ${spec.minWords}`);
  if (spec.expectSearch && seen.tool !== "websearch") warns.push("websearch was not called (the model decides)");
  return { verdict: fails.length > 0 ? "FAIL" : warns.length > 0 ? "WARN" : "PASS", fails, warns };
}

/** The numbers of `vm_stat`, in gigabytes; null when the tool is absent. */
export function parseVmStat(output: string): { freeGb: number; inactiveGb: number; wiredGb: number; compressedGb: number } | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(output)?.[1]);
  if (!pageSize) return null;
  const pages = (label: string): number => Number(new RegExp(`^${label}:\\s+(\\d+)`, "m").exec(output)?.[1] ?? 0);
  const gb = (n: number): number => Math.round(((n * pageSize) / 1024 ** 3) * 100) / 100;
  return {
    freeGb: gb(pages("Pages free") + pages("Pages speculative")),
    inactiveGb: gb(pages("Pages inactive")),
    wiredGb: gb(pages("Pages wired down")),
    compressedGb: gb(pages("Pages occupied by compressor")),
  };
}
