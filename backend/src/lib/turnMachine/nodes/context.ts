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
import { resolveOrCreateConversation, buildConversationWindow, isTemporaryConversation, windowPreview, type ConversationWindow } from "@/lib/conversationHistory";
import { countTokens } from "@/lib/tokenCount";
import { contextToMessages } from "../messages";
import { toolSpecFor, replyMaxTokensFor } from "./model";
import { recall, getProfileParagraph, embedQueryForRecall, bumpUsage } from "@/lib/memory";
import { subjectRosterFor } from "@/lib/subjects";
import { subjectsForTurn } from "@/lib/askNames";
import type { SubjectRef } from "@/lib/unknownNames";
import { getHouseholdSettingValue } from "@/lib/settings";
import { speakerAgeBand } from "@/lib/ageBand";
import { MAX_MEMORY_SNIPPETS } from "@/lib/turnShared";
import { recallEpisodes, formatEpisodesForPrompt, episodeQueryEligible, asksWhatHubSaid, earliestDroppedTurn, contentTerms, PROMPT_BLOCK_MAX_LINES, EARLIER_HEADER, ASKS_ABOUT_START_RE, type EpisodeMatch } from "@/lib/episodes";
import { isBareSocialTurn } from "@/lib/guards";
import { sanitizeForPrompt } from "@/lib/promptSanitize";
import { speakerIsAnonymous, turnAgeBand } from "../speaker";
import { shapeOf } from "@/lib/turnSignal";
import { planFor } from "@/lib/register";
import type { Node, ContextItem, TurnState } from "../contract";

/** MEMORY-FLOOR-01: the floor on recall()'s own composite `score`
 * below which a match never becomes a context item, a pinned record
 * exempted (see its own use site below for the full account and the
 * bench numbers behind 0.1). */
export const MEMORY_CONTEXT_MIN_SCORE = 0.1;

/** THIN-3C: the share of the history space a turn that may call a tool
 * keeps free for that round's call and results. */
export const TOOL_ROUND_SHARE = 0.25;

/** "Reasoning is a second output" (the owner's ruling): decided once,
 * here, from the age band and the surface - "a minor's turn never
 * receives reasoning" (the old engine file's own `ageBand === "child" ||
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
export function decideReasoning(state: Pick<TurnState, "actor" | "surface" | "spoken" | "speakerEvidence">): TurnState["reasoning"] {
  // THIN-0N: the speaker's effective band, as the old path derives it.
  const band = turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date());
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
  /** THIN-0B: the age projection withheld at least one household record
   * from this child or teen (recall()'s own withheldForBand count, the
   * old path's `memoryMatches.withheldForBand > 0`). applyContext() folds
   * it into the plan, so the model is told and the reply defers to a
   * trusted adult. Absent or false for an adult and for a turn with
   * nothing withheld. */
  disclosureWithheld?: boolean;
  /** THIN-7E (ASK-01): the turn's subjects and the unknown name the reply asks about. */
  subjects?: SubjectRef[];
  unknownAsk?: string | null;
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
  let disclosureWithheld = false;

  // GROUND-01 (state record, step 3): the current utterance joins the
  // context list as its own item, source "utterance" - the list's own
  // contract says it is the prompt's only input, so the utterance
  // belongs on it structurally, not just as the separate parameter
  // messages.ts also takes. Never answer evidence on purpose: source
  // "utterance" is excluded from the grounding checks (quoting the question
  // back proves nothing) and from the prompt's context block in messages.ts
  // (it is already the turn's final user message there, never printed twice).
  items.push({ id: "utterance", text: input.utterance, source: "utterance", subjects: [], disclosure: "child_ok" });

  // The window (THIN-3C): every turn after the summary's anchor, sized by
  // the engine's count once the rest of the prompt is known (below). What
  // the name resolution needs from it is read now.
  const windowOpts = { supersedes: state.supersedes, excludeTurnId: state.continuation?.fromTurnId };
  const preview = windowPreview(conversation, windowOpts);
  const pushWindow = (window: ConversationWindow) => {
    for (const message of window.messages) {
      // ContextItem has no role field (the contract's own shape); the
      // window's real user/assistant/tool ordering is real signal
      // messages.ts's contextToMessages() must not lose, so it rides in
      // the id, the one place a source-specific detail can travel without
      // widening the contract for every other source. Parsed back out by
      // windowRoleFromId() in messages.ts - the two stay paired on purpose.
      items.push({ id: `window-${message.role}-${++windowItemSeq}`, text: typeof message.content === "string" ? message.content : JSON.stringify(message.content), ...(message.tool_calls ? { toolCalls: message.tool_calls } : {}), ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}), source: "window", subjects: [], disclosure: "child_ok" });
    }
    if (window.summaryLine) {
      items.push({ id: `window-system-summary`, text: window.summaryLine, source: "window", subjects: [], disclosure: "child_ok" });
    }
  };

  // THIN-7C (bare mode): the raw model sees the conversation and nothing the
  // household's own data adds: no memory, profile, episode, clock or roster.
  if (state.bare) {
    pushWindow(await buildConversationWindow(conversation, windowOpts));
    return { outcome: { ok: true }, output: { conversationId: conversation.id, temporary, items, reasoning: decideReasoning(state) } };
  }

  // THIN-7E (ASK-01, rule 12): the names in the utterance, resolved before the model runs
  // (askNames.ts over unknownNames.ts). The unknown line ("Names in this message you have
  // never heard before: ...") and one line per registry subject go ahead of the memory
  // block; the question itself is appended to the reply by the model node.
  const recentUserTexts = preview.userTexts;
  const resolvedSubjects = subjectsForTurn({ actor: state.actor, text: input.utterance, signal: state.signal, recentUserTexts, conversationId: conversation.id, supersedes: state.supersedes, turnId: state.turnId, temporary });
  if (resolvedSubjects.section) items.push({ id: "subjects", text: resolvedSubjects.section, source: "subjects", subjects: [], disclosure: "child_ok" });

  // RECALL-03, run once the window is sized (below): set inside the
  // persisted-chat branch, so a temporary chat recalls nothing.
  let recallEarlier: ((window: ConversationWindow) => Promise<void>) | null = null;

  // Memories, dated and labeled (U5/REPLY-FIND-04's own shape): never
  // for a temporary chat (no memory:write either - the policy node's
  // own rule - and nothing here should ground a temporary answer in a
  // durable record that outlives it).
  if (!temporary) {
    // CONTEXT-RECALL-01 (dev.md "The owner's three live turns", (2)):
    // carries the old path's own recall call whole (the old engine file
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
    // withholdSensitive's robot half is deliberately stricter than
    // turnContext.ts's own sensitiveAllowed(): every robot-surface turn
    // withholds sensitive records, even for a confirmed, alone speaker,
    // until a presence check lands here too. THIN-0D: anonymous is the
    // old path's own derivation (effectiveBand(): a robot turn whose
    // speaker_evidence does not name the signed-in person), so an
    // unidentified speaker recalls no person-scope record, and only the
    // household records a child may see.
    const withholdSensitive = state.surface === "robot" || ageBand === "child" || ageBand === "teen";
    const anonymous = speakerIsAnonymous(state);
    const queryVector = await embedQueryForRecall(input.utterance);
    const recalled = recall(state.actor, input.utterance, {
      selfOnly: true,
      asOf: now,
      queryVector,
      withholdSensitive,
      anonymous,
      // #88's own excludeSource (THIN-7C): an edited turn's own resend never
      // recalls what the replaced turn put in memory.
      excludeSource: state.supersedes,
      // A code review caught this call bumping uses/last_used_at on
      // every one of recall()'s top-20 scored candidates (the default)
      // instead of only the up to MAX_MEMORY_SNIPPETS that actually
      // reach the prompt below - RecallOptions.bumpUsage's own comment
      // names exactly this ("the turn engine... bumps only the subset
      // that actually reached the model's prompt"), which the old engine file
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
    // The old path has no equivalent filter either (the old engine file's
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
    // THIN-0B: the old path's own derivation (the old engine file, basePlan's
    // `disclosureWithheld: memoryMatches.withheldForBand > 0`), limited
    // here to a child or teen: an adult is never told something is held
    // back, so an adult's plan stays as it was.
    disclosureWithheld = (ageBand === "child" || ageBand === "teen") && recalled.withheldForBand > 0;
    const matches = recalled
      .filter((m) => m.forceInclude || m.score >= MEMORY_CONTEXT_MIN_SCORE)
      // THIN-0D: effectiveBand() treats an unidentified robot speaker as
      // the child band, so the household records it may see are the
      // child_ok ones (recall() itself filters by the signed-in person's
      // band, which is not the speaker's).
      .filter((m) => !anonymous || m.record.child_disclosure === "child_ok")
      .slice(0, MAX_MEMORY_SNIPPETS);
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

    // The old path's own `anonymous || temporary ? undefined`: the profile
    // is the signed-in person's.
    const profile = anonymous ? null : getProfileParagraph(state.actor);
    if (profile) {
      items.push({ id: `profile-${profile.id}`, text: profile.text, source: "profile", subjects: [], disclosure: profile.child_disclosure ?? "adult_only", at: profile.created_at });
    }

    // THIN-0F (rules 4 and 12, ported from the old engine file's episode
    // recall): what the person actually said earlier, verbatim, beside the
    // extracted facts. Injected context, never a tool. Per-person scoping
    // lives inside recallEpisodes() (a person's own rows only), and the same
    // withholdSensitive/anonymous floors as the memory recall above apply.
    // Never for a temporary chat (this block is inside the !temporary guard).
    const episodeLocale = (getHouseholdSettingValue("household.locale") as string | undefined) ?? "en-US";
    const displayName = sanitizeForPrompt(state.actor.displayName);
    // Earlier conversations: this conversation is excluded whole, its turns
    // are the window's job. The person's own side only, unless the question
    // asks what the hub said (then the hub's side comes as a reported note).
    const episodeMatches = episodeQueryEligible(input.utterance)
      ? recallEpisodes(state.actor, input.utterance, queryVector, { now, excludeConversationId: conversation.id, excludeWholeConversation: true, limit: PROMPT_BLOCK_MAX_LINES, withholdSensitive, anonymous, ...(asksWhatHubSaid(input.utterance) ? { sides: "both" as const, preferHubSide: true } : { sides: "user" as const }) })
      : [];
    recallEarlier = async (window: ConversationWindow) => {
      // RECALL-03: this conversation's own turns that fell out of the window
      // are evidence too, the person's words only, and the earliest dropped
      // turn when the question is about how the chat began.
      const earlierMatches: EpisodeMatch[] = [];
      if (window.droppedOlder) {
        const byFloors = contentTerms(input.utterance).length >= 2 && !isBareSocialTurn(input.utterance)
          ? recallEpisodes(state.actor, input.utterance, queryVector, { now, withinConversationId: conversation.id, excludeTurnIds: state.supersedes ? [...window.turnIds, state.supersedes] : window.turnIds, sides: "user", limit: 2, withholdSensitive, anonymous })
          : [];
        earlierMatches.push(...byFloors.map((m) => ({ ...m, earlierInThisConversation: true })));
        if (ASKS_ABOUT_START_RE.test(input.utterance)) {
          const first = earliestDroppedTurn(state.actor, conversation.id, state.supersedes ? [...window.turnIds, state.supersedes] : window.turnIds, state.supersedes ?? null);
          if (first && !earlierMatches.some((m) => m.episode.turnId === first.episode.turnId)) earlierMatches.unshift({ ...first, earlierInThisConversation: true });
        }
      }
      const earlierBlock = formatEpisodesForPrompt(earlierMatches, displayName, episodeLocale, now, EARLIER_HEADER);
      if (earlierBlock) items.push({ id: "episodes-earlier-in-conversation", text: earlierBlock, source: "episode", subjects: [], disclosure: "child_ok" });
    };
    const episodesBlock = formatEpisodesForPrompt(episodeMatches, displayName, episodeLocale, now);
    if (episodesBlock) items.push({ id: "episodes-earlier-conversations", text: episodesBlock, source: "episode", subjects: [], disclosure: "child_ok" });
  }

  // The clock: always real, never a memory - the almanac's own
  // "computed, not recalled" rule (RULES-AND-LEARNED-COMPONENTS.md).
  const locale = (getHouseholdSettingValue("household.locale") as string | undefined) ?? "en-US";
  const now = new Date();
  items.push({ id: "clock", text: `${now.toLocaleString(locale, { dateStyle: "full", timeStyle: "short" })}\nThe model's training knowledge may be older than today.`, source: "clock", subjects: [], disclosure: "child_ok" });

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

  // THIN-3C (rule 4): the history budget is the engine's per-slot context
  // less this turn's own reply ceiling and the engine's count of the rest
  // of the prompt as the model node will send it (stable prefix, tools
  // block, memory, episodes, clock, roster, the summary and the message).
  // A failed count leaves the budget unmeasured and the window at its
  // named minimum.
  const reasoning = decideReasoning(state);
  const surfaceClass = state.planBasis.surfaceClass ?? "spoken";
  const thinking = state.budget.thinking_budget_tokens > 0 && reasoning.emit;
  const summaryItem: ContextItem[] = preview.summaryLine ? [{ id: "window-system-summary", text: preview.summaryLine, source: "window", subjects: [], disclosure: "child_ok" }] : [];
  const tools = state.budget.tools_offered.slice().sort().map(toolSpecFor).filter((t): t is NonNullable<typeof t> => t !== null);
  const rest = await countTokens(contextToMessages([...items, ...summaryItem], input.utterance, state.persona, state.plan, state.signal, surfaceClass), { tools });
  // A Stack that reports no context length leaves the window unmeasured
  // too (THIN-3A's named minimum): its 2,048-token stand-in is a floor,
  // not the engine's real size.
  const measured = rest !== null && state.budget.context_window_tokens !== null && state.budget.context_window_tokens !== undefined;
  // A turn that may run a tool round keeps TOOL_ROUND_SHARE of what is
  // left for the round's own messages (the call and its results, which
  // the composer sizes to the context), so history at its high-water mark
  // still leaves a search room to land (a review).
  const left = measured ? Math.max(0, state.budget.context_tokens - replyMaxTokensFor(state, thinking) - rest) : null;
  const historyBudgetTokens = left === null ? null : Math.floor(tools.length > 0 ? left * (1 - TOOL_ROUND_SHARE) : left);
  const window = await buildConversationWindow(conversation, { ...windowOpts, historyBudgetTokens });
  pushWindow(window);
  if (recallEarlier) {
    // RECALL-03's block joins after the window is sized, so it is counted
    // here and left out when it does not fit beside the window (a review).
    const before = items.length;
    await recallEarlier(window);
    const added = items.slice(before);
    if (added.length > 0 && historyBudgetTokens !== null && window.historyTokens !== null) {
      const extra = await countTokens(added.map((item) => ({ role: "system" as const, content: item.text })));
      if (extra === null || window.historyTokens + extra > historyBudgetTokens) items.splice(before, added.length);
    }
  }

  return { outcome: { ok: true }, output: { conversationId: conversation.id, temporary, items, reasoning, disclosureWithheld, subjects: resolvedSubjects.subjects, unknownAsk: resolvedSubjects.unknownAsk } };
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
  if (output.subjects) state.subjects = output.subjects;
  state.unknownAsk = output.unknownAsk ?? null;
  if (output.disclosureWithheld) {
    // THIN-0B: the plan's inputs, recomputed once with the withheld flag,
    // and the trusted-adult move when a child or teen asked a question
    // (the old path's `mayDefer` also asks for a named household subject
    // and answers with a fixed line; the default path has no subject
    // resolution yet, so the model is told and the plan requires the
    // defer move instead). Every other planBasis input is unchanged.
    const deferred = shapeOf(state.signal, state.utterance) === "question";
    state.planBasis = { ...state.planBasis, disclosureWithheld: true, deferred };
    state.plan = planFor({ ...state.planBasis, evidence: { choices: 0, sources: 0, deliverable: false } });
  }
}
