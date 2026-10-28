// NAT-01 register bench, pure half: scoring by regex, no engine, no database.
// Rule 6a: a verdict carries a pattern or rule id, never reply text.
export type Mechanic = "clock" | "hedge" | "evidential" | "reask" | "price" | "date" | "opinion" | "news";
export type Verdict = "pass" | "fail" | "ambiguous";
export const MECHANICS: readonly Mechanic[] = ["clock", "hedge", "evidential", "reask", "price", "date", "opinion", "news"];

/** The evidence a row seeds and what the bench expects the model to have been given. */
export interface RowEvidence {
  /** Substrings (case-insensitive) that must appear in what the model received: the raw value as the tools and memory hand it over today. */
  raw: string[];
  /** A regex for the shaped form (the `say` phrase NAT-02 to NAT-04 will hand the model). Absent when the value is exact-marked. */
  shaped?: string;
  /** The value is exact-marked (money owed, an appointment): a rounded reply must fail. */
  exact?: boolean;
}

export interface RegisterRow {
  id: string;
  mechanic: Mechanic;
  /** One utterance, or two for a re-ask pair (the second is scored). */
  utterances: string[];
  /** Prompt clock (local ISO date-time) per turn; one entry applies to every turn. */
  clocks?: string[];
  /** Household memory lines seeded before the conversation (the evidence the turn recalls). */
  seed?: string[];
  /**
   * The typed outcome a package returns (NAT-01 seam: seeded by package id and
   * the tool call is scripted, so the model composes from it every run). The
   * hedge and price rows use this.
   */
  outcome?: { package: string; args: Record<string, unknown>; result: { reply: { text: string }; actions: { kind: string; payload?: unknown }[]; data?: Record<string, unknown> } };
  /** A recorded search result the lookup returns (news rows); the bench scripts the search call, so delivery no longer depends on the model choosing it. */
  search?: { prompt: string; title: string; content: string; as_of: string };
  /** The re-ask rows run on the spoken surface only. */
  surface?: "chat" | "robot";
  /** "shorter": the scored (second) reply must be shorter than the first. */
  lengthRule?: "shorter";
  evidence: RowEvidence;
  failPatterns: string[];
  passPatterns: string[];
}

export interface Score { verdict: Verdict; matchedPattern: string | null }

const STUB_PREFIX = /^\s*\[(?:stub model|error:)/i;

/** Scores the (last) reply. `first` is the earlier reply of a re-ask pair. */
export function scoreRegisterReply(row: RegisterRow, reply: string, first?: string): Score {
  // Against the in-process stub every reply is an echo: nothing to judge.
  if (!reply.trim() || STUB_PREFIX.test(reply)) return { verdict: "ambiguous", matchedPattern: null };
  const fail = row.failPatterns.find((pattern) => new RegExp(pattern, "i").test(reply));
  if (fail) return { verdict: "fail", matchedPattern: fail };
  if (row.lengthRule === "shorter") {
    if (first === undefined || !first.trim() || STUB_PREFIX.test(first)) return { verdict: "ambiguous", matchedPattern: null };
    return reply.length < first.length ? { verdict: "pass", matchedPattern: null } : { verdict: "fail", matchedPattern: "length:not-shorter" };
  }
  const pass = row.passPatterns.some((pattern) => new RegExp(pattern, "i").test(reply));
  return pass ? { verdict: "pass", matchedPattern: null } : { verdict: "ambiguous", matchedPattern: null };
}

const HEDGE = /\b(might|maybe|possibly|probably|likely|pretty sure|almost certainly|doubt)\b/i;
export function scoreHedgePair(low: string, high: string): Score {
  if (STUB_PREFIX.test(low) || STUB_PREFIX.test(high)) return { verdict: "ambiguous", matchedPattern: null };
  const a = low.match(HEDGE)?.[0]?.toLowerCase();
  const b = high.match(HEDGE)?.[0]?.toLowerCase();
  if (!a || !b) return { verdict: "ambiguous", matchedPattern: null };
  return a !== b ? { verdict: "pass", matchedPattern: null } : { verdict: "fail", matchedPattern: `same-hedge:${a}` };
}

export interface EvidenceCheck {
  /** Raw substrings found in what the model received, of those the row names. */
  rawFound: number;
  rawTotal: number;
  /** null when the row has no shaped form to look for (exact-marked values). */
  shaped: boolean | null;
}

/** What the model actually received (the system messages and last user message the recording proxy kept). */
export function checkEvidence(evidence: RowEvidence, received: string | null): EvidenceCheck {
  const text = (received ?? "").toLowerCase();
  const rawFound = evidence.raw.filter((value) => text.includes(value.toLowerCase())).length;
  // The spoken form only counts when the seeded value itself reached the model; generic prompt words must not match.
  const shaped = evidence.shaped === undefined ? null : rawFound > 0 && new RegExp(evidence.shaped, "i").test(received ?? "");
  return { rawFound, rawTotal: evidence.raw.length, shaped };
}

/**
 * Everything the model really received for a turn: each request's system
 * messages and tool-result messages, with the person's own words cut out so a
 * value only the utterance holds cannot count as delivered. Null when the
 * turn made no model call.
 */
export function receivedByModel(requests: readonly { contextText: string; toolText?: string }[]): string | null {
  if (requests.length === 0) return null;
  return requests.map((r) => [r.contextText.split("The person's words:")[0]!, r.toolText ?? ""].filter(Boolean).join("\n")).join("\n");
}
