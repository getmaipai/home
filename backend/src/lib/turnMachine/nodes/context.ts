// U2b, the `context` node (turn-machine-state-record-2026-09-22.md's
// state table): "the window (in-process for a temporary chat), the
// memories as dated and labeled items, the episodes, the profile line,
// the clock, the roster, the disclosure filter for this reader and the
// presence on this surface." Per U2b's own brief, "context builds the
// ContextItem list from what the old path assembles" - this reuses the
// same real assembly functions the old path calls (buildConversationWindow,
// memory.recall, getProfileParagraph, subjectRosterFor), never a
// reimplementation of memory retrieval or disclosure filtering: those
// stay in memory.ts's own canRead() (RULES-AND-LEARNED-COMPONENTS.md,
// "household privacy and disclosure ... filtered before the prompt,
// never left to the model").
import { resolveOrCreateConversation, buildConversationWindow, isTemporaryConversation } from "@/lib/conversationHistory";
import { recall, getProfileParagraph, embedQueryForRecall, bumpUsage } from "@/lib/memory";
import { subjectRosterFor } from "@/lib/subjects";
import { getHouseholdSettingValue } from "@/lib/settings";
import { speakerAgeBand } from "@/lib/ageBand";
import { MAX_MEMORY_SNIPPETS } from "@/lib/turnEngine";
import type { Node, ContextItem, TurnState } from "../contract";

/** MEMORY-FLOOR-01: the floor on recall()'s own composite `score`
 * below which a match never becomes a context item, a pinned record
 * exempted (see its own use site below for the full account and the
 * bench numbers behind 0.1). */
export const MEMORY_CONTEXT_MIN_SCORE = 0.1;

/** "Reasoning is a second output" (the owner's ruling): decided once,
 * here, from the age band and the surface - "a minor's turn never
 * receives reasoning" (turnEngine.ts's own `ageBand === "child" ||
 * ageBand === "teen"` is the established "not a full adult" check,
 * reused rather than a second one) and "the typed chat screen is the
 * only surface that may emit it." VOICE-LIVE-02: a spoken turn is
 * withheld the same way even when `surface` is literally "chat" (a
 * live voice session posts on the chat surface too) - the state
 * record's own words name "voice" as one of the surfaces that never
 * shows reasoning, and there is nowhere for a spoken reply to put a
 * Reasoning Element regardless of which surface field it arrived on.
 * Presence is left out on purpose: no presence signal exists on the
 * hub yet (this file's own header note), so `"presence"` is never
 * produced until one is built. */
export function decideReasoning(state: Pick<TurnState, "actor" | "surface" | "spoken">): TurnState["reasoning"] {
  const band = speakerAgeBand(state.actor, new Date());
  if (band === "child" || band === "teen") return { emit: false, withheld_for: "minor" };
  if (state.surface !== "chat" || state.spoken) return { emit: false, withheld_for: "surface" };
  return { emit: true, withheld_for: null };
}

export interface ContextInput {
  utterance: string;
  /** Whether THIS call asked for a fresh temporary chat (turnNext.ts's
   * own opts.temporary) - resolveOrCreateConversation() only reads
   * this when conversationId is empty; an existing id (temporary or
   * not) is authoritative on its own, the same rule the old path's
   * TEMP-CHAT-01 already established. */
  temporary?: boolean;
}

export interface ContextOutput {
  conversationId: string;
  temporary: boolean;
  items: ContextItem[];
  reasoning: TurnState["reasoning"];
}

let windowItemSeq = 0;

export const contextNode: Node<ContextInput, ContextOutput> = async (state, input) => {
  const resolved = resolveOrCreateConversation(state.actor, state.surface, state.conversationId || undefined, { temporary: input.temporary });
  if (!resolved.ok) {
    return { outcome: { ok: false, code: String(resolved.status) }, output: { conversationId: state.conversationId, temporary: false, items: [], reasoning: decideReasoning(state) } };
  }
  const conversation = resolved.value;
  const temporary = isTemporaryConversation(conversation.id) || conversation.mode === "temporary";

  const items: ContextItem[] = [];

  // GROUND-01 (state record, step 3): the current utterance joins the
  // context list as its own item, source "utterance" - the list's own
  // contract says it is the prompt's only input, so the utterance
  // belongs on it structurally, not just as the separate parameter
  // messages.ts also takes. Never answer evidence on purpose: source
  // "utterance" is excluded from contextQuoteGrounded in machine.ts
  // (quoting the question back proves nothing) and from the prompt's
  // context block in messages.ts (it is already the turn's final user
  // message there, never printed twice). This does not by itself
  // shorten the diagnosis's "cause 2" retry (a model quoting the
  // question for answer_from_context still meets the same exclusion
  // and forces the same forceSearchOnly round) - that path is
  // `answer_from_context_tool: false` in every real budget today
  // (Astra's review, the escape is off until reuse-with-freshness is
  // built), so the extra round has no live cost to eliminate right
  // now; this item exists so the exclusion is a stated, tested rule
  // rather than an accident of what wasn't in the list yet.
  items.push({ id: "utterance", text: input.utterance, source: "utterance", subjects: [], disclosure: "child_ok" });

  // The window: every prior turn this conversation already holds,
  // verbatim (RECALL-03's own window, unchanged for a temporary chat -
  // buildConversationWindow() reads the in-process session the same
  // way it reads a persisted one, so "context reads no table" for a
  // temporary chat is buildConversationWindow()'s own property, not
  // something this node has to special-case).
  const window = buildConversationWindow(conversation);
  for (const message of window.messages) {
    // ContextItem has no role field (the contract's own shape); the
    // window's real user/assistant/tool ordering is real signal
    // messages.ts's contextToMessages() must not lose, so it rides in
    // the id, the one place a source-specific detail can travel without
    // widening the contract for every other source. Parsed back out by
    // windowRoleFromId() in messages.ts - the two stay paired on purpose.
    items.push({ id: `window-${message.role}-${++windowItemSeq}`, text: message.content, source: "window", subjects: [], disclosure: "child_ok" });
  }
  if (window.summaryLine) {
    items.push({ id: `window-system-summary`, text: window.summaryLine, source: "window", subjects: [], disclosure: "child_ok" });
  }

  // Memories, dated and labeled (U5/REPLY-FIND-04's own shape): never
  // for a temporary chat (no memory:write either - the policy node's
  // own rule - and nothing here should ground a temporary answer in a
  // durable record that outlives it).
  if (!temporary) {
    // CONTEXT-RECALL-01 (dev.md "The owner's three live turns", (2)):
    // carries the old path's own recall call whole (turnEngine.ts
    // around line 3290, hard-won logic), never a bare recall(actor,
    // utterance) - that fell to the lenient keyword-overlap path with
    // no tier floor at all, which is why a fresh conversation's small
    // talk got answered as if a remembered lookup were the question.
    // "No rule, no signal switch" (the owner's own words): nothing
    // here branches on question-vs-inform - the tier floor this query
    // vector enables, plus messages.ts's own framing of the result, do
    // the whole job.
    const now = new Date();
    const ageBand = speakerAgeBand(state.actor, now);
    // withholdSensitive's robot half mirrors turnContext.ts's own
    // sensitiveAllowed(): missing presence data withholds rather than
    // guesses, and no presence signal exists on the new path yet
    // (this file's own header note) - so every robot-surface turn
    // withholds sensitive records until a real speaker-evidence/
    // presence system lands here too. anonymous stays false for the
    // same reason: no unknown-speaker-default path exists on the new
    // engine yet either.
    const withholdSensitive = state.surface === "robot" || ageBand === "child" || ageBand === "teen";
    const anonymous = false;
    const queryVector = await embedQueryForRecall(input.utterance);
    const recalled = recall(state.actor, input.utterance, {
      selfOnly: true,
      asOf: now,
      queryVector,
      withholdSensitive,
      anonymous,
      // #88's own excludeSource (an edited turn's own resend): no
      // supersede concept exists on the new path yet, so nothing to
      // exclude - the option rides along so a later edit-and-resend
      // build only has to supply a value here, never re-wire the call.
      excludeSource: undefined,
      // A code review caught this call bumping uses/last_used_at on
      // every one of recall()'s top-20 scored candidates (the default)
      // instead of only the up to MAX_MEMORY_SNIPPETS that actually
      // reach the prompt below - RecallOptions.bumpUsage's own comment
      // names exactly this ("the turn engine... bumps only the subset
      // that actually reached the model's prompt"), which turnEngine.ts
      // already honors this same way (its own bumpUsage() call after
      // its own prompt-inclusion filter).
      bumpUsage: false,
    });
    // MEMORY-FLOOR-01 (getmaipai/home, found live LIVE-0923-01 (6)): a
    // short, topic-free remark used to still reach recall()'s own
    // "best available" match by embedding distance alone, however
    // weak, and every sliced candidate became a context item with no
    // further check - a context leak, privacy-adjacent (a household
    // topic that never came up in this conversation, surfaced anyway).
    // The old path has no equivalent filter either (turnEngine.ts's
    // own memoryMatches = recall(...) call, checked directly: no
    // eligibility or score gate ahead of it) - nothing to export and
    // reuse, so this floor is new, scoped to this call site only.
    // recall()'s own composite `score` already blends cosine,
    // importance and recency (memory.ts's COSINE_WEIGHT/IMPORTANCE_
    // WEIGHT/RECENCY_WEIGHT) plus a flat entity-match bonus, so it
    // isn't a pure similarity number DURABLE_MIN_COSINE/EPISODIC_
    // MIN_COSINE could be compared against directly - measured
    // instead, against scripts/bench/memory-eval.ts's own 11 probes
    // (a resident engine, embed url, 2026-09-24): every genuinely
    // wanted match in the currently-passing rows scores 0.125 or
    // higher (the weakest, episodic-relevant's own baseball-game
    // recall); a pinned or entity-matched record can legitimately
    // score near 0.000 against an unrelated remark and still has to
    // surface (pinned-identity's own row - "the household said
    // 'always surface this'"; a named entity, "the plan's own words
    // for the exact same treatment" per memory.ts's own comment) -
    // the exemption is recall()'s own `forceInclude` flag (RecallMatch,
    // a review caught the first cut of this floor checking only
    // `record.pinned`, silently dropping a weak-cosine entity match
    // recall() itself force-included - fixed by exporting the flag
    // instead of half-reproducing recall()'s own decision here). 0.1
    // sits with real margin under 0.125, never moved a single one of
    // the bench's 7 passing rows (verified twice), and already drops
    // the noise a weak, non-forced entity match rides in on
    // (entity-recall's own row: 12 candidates including six at
    // 0.056-0.059 down to the 4 that actually matter, still passing).
    const matches = recalled.filter((m) => m.forceInclude || m.score >= MEMORY_CONTEXT_MIN_SCORE).slice(0, MAX_MEMORY_SNIPPETS);
    // Every sliced match becomes a context item below, unconditionally
    // (no further filtering happens after this point) - so the matches
    // array itself is exactly "what reached the prompt," the same
    // bump the old path's own subset-only call makes.
    bumpUsage(matches);
    for (const match of matches) {
      const r = match.record;
      items.push({
        id: `memory-${r.id}`,
        text: r.text,
        source: "memory",
        subjects: r.subject_id ? [r.subject_id] : [],
        disclosure: r.child_disclosure ?? "adult_only",
        at: r.created_at,
      });
    }

    const profile = getProfileParagraph(state.actor);
    if (profile) {
      items.push({ id: `profile-${profile.id}`, text: profile.text, source: "profile", subjects: [], disclosure: profile.child_disclosure ?? "adult_only", at: profile.created_at });
    }
  }

  // The clock: always real, never a memory - the almanac's own
  // "computed, not recalled" rule (RULES-AND-LEARNED-COMPONENTS.md).
  const locale = (getHouseholdSettingValue("household.locale") as string | undefined) ?? "en-US";
  const now = new Date();
  items.push({ id: "clock", text: now.toLocaleString(locale, { dateStyle: "full", timeStyle: "short" }), source: "clock", subjects: [], disclosure: "child_ok" });

  // The roster: who this household has, so "he"/"she"/a name resolves
  // against real people without a pronoun-guessing rule. One item per
  // name, never one joined "Household: X, Y." line: a joined line
  // would need a regex to read back apart wherever a node wants the
  // plain name list (model.ts's household-subject check, policy.ts's
  // own copy of it) - the rule-budget lint's own zero baseline for
  // turnMachine/ is the reason this is a list of items, not a sentence.
  const roster = subjectRosterFor(state.actor);
  roster.forEach((name, i) => {
    items.push({ id: `roster-${i}`, text: name, source: "roster", subjects: [], disclosure: "child_ok" });
  });

  return { outcome: { ok: true }, output: { conversationId: conversation.id, temporary, items, reasoning: decideReasoning(state) } };
};

/** Applies the node's output onto TurnState, the same small
 * "write-back" pattern nodes/safety.ts's applySafety() uses - kept out
 * of the node function itself so a test can call contextNode() and
 * inspect its output without a whole TurnState to mutate. */
export function applyContext(state: import("../contract").TurnState, output: ContextOutput): void {
  state.conversationId = output.conversationId;
  state.temporary = output.temporary;
  state.context = output.items;
  state.reasoning = output.reasoning;
}
