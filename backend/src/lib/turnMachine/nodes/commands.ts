// U2b, the `commands` node (turn-machine-state-record-2026-09-22.md's
// state table): "the utterance against the closed exact-match set
// (household commands, the bundled closed intents: lights, timers,
// lists, reminders, 'what time is it', 'remember that', 'forget that',
// the almanac) - answers without the model, nothing fuzzy" (build plan
// point 2). Two sources of exact patterns, both already staying under
// RULES-AND-LEARNED-COMPONENTS.md's "deterministic on purpose" table:
// the household's own custom commands (lib/commands.ts's matchCommand,
// the `commands` DB table) and the bundled packages' own closed
// `routing.patterns` (matchPattern, the old engine file - kept, never
// deleted; only the model-offered tool set and the lookup ladder that
// used to sit in front of it are going). A package whose routing is
// `always_offer` (websearch) is a tool for the model node, never an
// instant command here - matching it on an exact literal would answer
// "search the web for X" without ever reaching the interim rule.
import { matchCommand, runCommand } from "@/lib/commands";
import { matchPattern, loadAllManifests } from "@/lib/turnShared";
import { FORGET_COMMAND_ID, forgetFromConversation, parseForgetCommand } from "@/lib/forgetCommand";
import { runPlugin, meetsMinRole } from "@/lib/plugins";
import { outcomeOf } from "@/lib/turnContext";
import { speakerIsAnonymous, touchesMemory } from "../speaker";
import { usableReply } from "@/lib/composer";
import { answerWhoTurn } from "@/lib/askNames";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { COMPUTED_WILDCARD_RESOLVERS, NEVER_FIRES_WILDCARDS } from "@/lib/manifestLint";
import type { Node, NodeOutcome } from "../contract";

export interface CommandsInput {
  utterance: string;
}

export type CommandsOutput =
  | { matched: false }
  // `whoAnswer` (THIN-7E): the reply is ASK-01's answer to a who question; the outcome is
  // only the answer node's input and is never recorded on the turn.
  | { matched: true; text: string; speech?: string; outcome: import("@/lib/turnContext").ToolExecutionOutcome; whoAnswer?: true };

export const commandsNode: Node<CommandsInput, CommandsOutput> = async (state, input) => {
  // THIN-7E (ASK-01): the answer to a question put on an earlier turn, or a judge's open
  // question answered before it is put, comes before every command, as on the old path
  // (after `safety`, before routing). The deterministic parser reads it; no model runs.
  // Not on a bare, ephemeral, continuation or crisis turn: nothing is learned there and the crisis reply stays the crisis reply.
  const answered = state.bare || state.ephemeral || state.continuation || state.crisis ? null : answerWhoTurn({ actor: state.actor, text: input.utterance, conversationId: state.conversationId, turnId: state.turnId, pendingWho: state.pendingWho ?? null, temporary: state.temporary });
  if (answered) {
    state.whoAnswer = true;
    state.subjects = answered.subjects;
    // An answer that states a kind is the inform the judge reads (the signal's protocol layer).
    state.signal = classifyTurnSignal({ text: input.utterance, protocol: answered.protocol, ageBand: state.planBasis.band });
    const outcome = outcomeOf({ callId: `ask:who`, packageId: "engine", status: "succeeded", via: "command", userMessage: answered.text });
    return { outcome: { ok: true }, output: { matched: true, text: answered.text, outcome, whoAnswer: true } };
  }

  // THIN-0A (issue #204): "forget that" / "forget what I told you about
  // X" is the engine's own exact command, the same parser and the same
  // conversation lookup the old path calls (the old engine file ~2566), so the
  // model never answers a forget with "Got it." and keeps the record.
  // Checked before the household's custom commands, as on the old path.
  // A temporary chat stores no turns and writes no memory, so it has
  // nothing to forget and touches nothing.
  const forget = parseForgetCommand(input.utterance);
  if (forget) {
    const text = state.temporary ? "There's nothing to forget in a temporary chat." : forgetFromConversation(state.actor, state.conversationId, forget.topic, state.turnId).reply;
    const outcome = outcomeOf({ callId: `command:${FORGET_COMMAND_ID}`, packageId: FORGET_COMMAND_ID, status: "succeeded", via: "command", userMessage: text });
    return { outcome: { ok: true }, output: { matched: true, text, outcome } };
  }

  const custom = matchCommand(input.utterance, state.actor);
  if (custom) {
    const result = await runCommand(custom);
    const outcome = outcomeOf({
      callId: `command:${custom.id}`,
      // A code review (2026-09-22) caught this prefixed ("command:x"),
      // where the old engine file's own reference builder uses the bare id
      // for TurnValue.command_id (matchedCommand.id, unprefixed) -
      // buildTurnValue() (turnNext.ts) copies this outcome's packageId
      // straight onto the wire, so a prefixed id here reached the
      // household's own client under a name the old engine file never used.
      packageId: custom.id,
      status: result.ok ? "succeeded" : "failed",
      via: "command",
      userMessage: result.ok ? result.value.text : result.error,
    });
    const okOutcome: NodeOutcome = { ok: true };
    return result.ok
      ? { outcome: okOutcome, output: { matched: true, text: result.value.text, speech: result.value.speech, outcome } }
      : { outcome: okOutcome, output: { matched: true, text: result.error, outcome } };
  }

  // THIN-0L (SAFETY-01): in the crisis state no package is routed by an
  // opener, as on the old path (`inCrisis` skips the route). The
  // conversation is never blocked: the model still answers.
  if (state.crisis) return { outcome: { ok: true }, output: { matched: false } };

  for (const { id, manifest } of loadAllManifests()) {
    if (manifest.routing?.always_offer) continue;
    if (!meetsMinRole(state.actor.role, manifest.min_role)) continue;
    // A code review (2026-09-22) caught this loop with neither of
    // the old engine file's own two guards on its identical literal-pattern
    // match: skipping a consequential manifest here (the old engine file
    // ~1696, the `lock-doors` finding) is what keeps a side-effecting
    // package from firing on a bare pattern match with no confirm -
    // without it, a literal match runs runPlugin() straight from this
    // node, which exits to `answer`, never reaching `policy`'s own
    // confirm gate at all. A consequential manifest still reaches the
    // model and `policy` normally; only the instant, un-confirmed path
    // here is closed to it.
    if (manifest.consequential) continue;
    // CHAT-PARITY-02's own guard (the old engine file ~2792), mirrored here:
    // a temporary chat may run an ordinary command, but never one that
    // declares memory:write - the same invariant `policy`'s own
    // temporary_mode check enforces for a model-proposed tool call,
    // applied here too since this loop runs before the model ever sees
    // the turn.
    if (state.temporary && manifest.permissions?.includes("memory:write")) continue;
    // THIN-0D: a package that reads memory reads the signed-in person's,
    // so an unidentified robot speaker never reaches it by an opener.
    if (speakerIsAnonymous(state) && touchesMemory(manifest)) continue;
    for (const pattern of manifest.routing?.patterns ?? []) {
      const captured = matchPattern(input.utterance, pattern);
      if (captured === null) continue;
      // OPENER-01 (state record "The machine," commands row; dev.md
      // "The knowledge hijack" (a)): an opener fires only as one of
      // three closed things. A fixed phrase (no `*`) always fires - it
      // is one exact meaning, matchPattern's own whole-string branch.
      // A wildcard fires only when its owning package declares a real
      // resolver for it (manifestLint.ts's own, single list: a
      // computed wildcard on a compute or clock package, gated on the
      // resolver accepting the captured remainder, never the pattern
      // text) or, failing that, only on a directive turn (an
      // imperative wildcard: the fixed part instructs the hub, the
      // remainder is the argument by definition). A wildcard that is
      // neither yields to the model, never fires blind.
      //
      // A code review caught a fourth case this scheme alone misses:
      // "tell me about *" grammatically IS a directive ("tell me...",
      // not an interrogative), so it would otherwise fire as an
      // "imperative" opener on exactly the directive-classified turns
      // it needs to be refused on - its remainder is the same open,
      // free-form topic "what is *"'s is, never a narrow
      // argument-by-definition. manifestLint.ts's own
      // NEVER_FIRES_WILDCARDS names the two bundled instances; checked
      // first, unconditionally, before the directive/resolver split.
      if (pattern.includes("*")) {
        if (NEVER_FIRES_WILDCARDS.has(`${id}:${pattern}`)) continue;
        const computedResolver = COMPUTED_WILDCARD_RESOLVERS[`${id}:${pattern}`];
        if (computedResolver) {
          if (!computedResolver(captured)) continue;
        } else if (state.signal.primary_act !== "directive") {
          continue;
        }
      }
      const args = captured ? { [firstArgName(manifest)]: captured } : {};
      const result = await runPlugin(id, state.actor, args, { id: state.turnId, conversationId: state.conversationId, ...(state.typedText !== undefined ? { typedText: state.typedText } : {}), ...(state.untrustedInput ? { untrusted: true } : {}) });
      // COMMAND-FAIL-01 (dev.md "The knowledge hijack" (b)): a failed
      // pattern outcome used to return `matched: true` with the raw
      // `result.error` as the reply text (an MCP error string, a
      // Wikipedia URL, once verbatim) and the wrong error code
      // (`String(result.status)`, discarding the plugin runner's own
      // typed `code` - plugins.ts's `{ ok: false, status, error, code,
      // fallback_reply }`). A failed run is not a match: the outcome
      // still joins `state.outcomes` (pushed here directly, the same
      // pattern model.ts's own `state.generations.push` already uses -
      // machine.ts's `recordCommandOutcome` only ever runs on the
      // `matched: true` branch), and the turn falls through to
      // `context`/`model` exactly as an unmatched utterance would, so
      // the model can say the lookup failed in its own words or answer
      // from what it knows. The fixed line stays the answer node's own
      // floor, reached only after a failed MODEL round too
      // (DEADLINE-01) - never this node's own text.
      if (!result.ok) {
        const outcome = outcomeOf({
          callId: `pattern:${id}`,
          packageId: id,
          status: "failed",
          via: "pattern",
          args,
          errorCode: result.code,
          userMessage: result.error,
        });
        state.outcomes.push(outcome);
        return { outcome: { ok: true }, output: { matched: false } };
      }
      const outcome = outcomeOf({
        callId: `pattern:${id}`,
        packageId: id,
        status: "succeeded",
        via: "pattern",
        args,
        result: result.value,
      });
      const okOutcome: NodeOutcome = { ok: true };
      // A closed intent's own recipe almost always binds `reply` directly
      // (a fixed shape, never needing the model to phrase it); the rare
      // data-only result (usableReply() null) falls back to a plain
      // acknowledgement rather than reaching for composeTurn()'s own
      // LLM call here - a real simplification for U2b's "simplest real
      // implementation," not a claim that every package's reply is
      // this direct.
      const reply = usableReply({ result: result.value });
      const text = reply?.text ?? "Done.";
      return { outcome: okOutcome, output: { matched: true, text, speech: reply?.speech, outcome } };
    }
  }

  return { outcome: { ok: true }, output: { matched: false } };
};

/** The manifest's own first declared argument name - the same "the
 * argument is the remainder by definition" rule RULES-AND-LEARNED-
 * COMPONENTS.md names for these patterns, applied generically instead
 * of per-package special-casing. Prefers `args.required[0]` (every
 * wildcard-capturing package until SIGNAL-02 declared its one argument
 * required - math/convert's "expression", weather's "place"); falls
 * back to `args.properties`' own first key for a package whose
 * distinguishing argument is declared optional instead (almanac-time's
 * "place": a bare "what time is it" must still validate with no place
 * at all, so the arg can't be required, but the wildcard capture still
 * needs a real name to bind to, not the old hardcoded "expression"
 * fallback that name never belonged to). A manifest with no argument at
 * all (an argument-less command like "what time is it" itself) never
 * reaches this: matchPattern's own captured text is empty for a
 * whole-string pattern. */
function firstArgName(manifest: { args?: { required?: string[]; properties?: Record<string, unknown> } }): string {
  return manifest.args?.required?.[0] ?? Object.keys(manifest.args?.properties ?? {})[0] ?? "expression";
}
