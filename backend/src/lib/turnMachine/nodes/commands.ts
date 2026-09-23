// U2b, the `commands` node (turn-machine-state-record-2026-09-22.md's
// state table): "the utterance against the closed exact-match set
// (household commands, the bundled closed intents: lights, timers,
// lists, reminders, 'what time is it', 'remember that', 'forget that',
// the almanac) - answers without the model, nothing fuzzy" (build plan
// point 2). Two sources of exact patterns, both already staying under
// RULES-AND-LEARNED-COMPONENTS.md's "deterministic on purpose" table:
// the household's own custom commands (lib/commands.ts's matchCommand,
// the `commands` DB table) and the bundled packages' own closed
// `routing.patterns` (matchPattern, turnEngine.ts - kept, never
// deleted; only the model-offered tool set and the lookup ladder that
// used to sit in front of it are going). A package whose routing is
// `always_offer` (websearch) is a tool for the model node, never an
// instant command here - matching it on an exact literal would answer
// "search the web for X" without ever reaching the interim rule.
import { matchCommand, runCommand } from "@/lib/commands";
import { matchPattern, loadAllManifests } from "@/lib/turnEngine";
import { runPlugin, meetsMinRole } from "@/lib/plugins";
import { outcomeOf } from "@/lib/turnContext";
import { usableReply } from "@/lib/composer";
import { COMPUTED_WILDCARD_RESOLVERS, NEVER_FIRES_WILDCARDS } from "@/lib/manifestLint";
import type { Node, NodeOutcome } from "../contract";

export interface CommandsInput {
  utterance: string;
}

export type CommandsOutput =
  | { matched: false }
  | { matched: true; text: string; speech?: string; outcome: import("@/lib/turnContext").ToolExecutionOutcome };

export const commandsNode: Node<CommandsInput, CommandsOutput> = async (state, input) => {
  const custom = matchCommand(input.utterance, state.actor);
  if (custom) {
    const result = await runCommand(custom);
    const outcome = outcomeOf({
      callId: `command:${custom.id}`,
      // A code review (2026-09-22) caught this prefixed ("command:x"),
      // where turnEngine.ts's own reference builder uses the bare id
      // for TurnValue.command_id (matchedCommand.id, unprefixed) -
      // buildTurnValue() (turnNext.ts) copies this outcome's packageId
      // straight onto the wire, so a prefixed id here reached the
      // household's own client under a name turnEngine.ts never used.
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

  for (const { id, manifest } of loadAllManifests()) {
    if (manifest.routing?.always_offer) continue;
    if (!meetsMinRole(state.actor.role, manifest.min_role)) continue;
    // A code review (2026-09-22) caught this loop with neither of
    // turnEngine.ts's own two guards on its identical literal-pattern
    // match: skipping a consequential manifest here (turnEngine.ts
    // ~1696, the `lock-doors` finding) is what keeps a side-effecting
    // package from firing on a bare pattern match with no confirm -
    // without it, a literal match runs runPlugin() straight from this
    // node, which exits to `answer`, never reaching `policy`'s own
    // confirm gate at all. A consequential manifest still reaches the
    // model and `policy` normally; only the instant, un-confirmed path
    // here is closed to it.
    if (manifest.consequential) continue;
    // CHAT-PARITY-02's own guard (turnEngine.ts ~2792), mirrored here:
    // a temporary chat may run an ordinary command, but never one that
    // declares memory:write - the same invariant `policy`'s own
    // temporary_mode check enforces for a model-proposed tool call,
    // applied here too since this loop runs before the model ever sees
    // the turn.
    if (state.temporary && manifest.permissions?.includes("memory:write")) continue;
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
      const args = captured ? { [firstRequiredArg(manifest)]: captured } : {};
      const result = await runPlugin(id, state.actor, args, { id: state.turnId, conversationId: state.conversationId });
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

/** The manifest's own first required argument name (`args.required[0]`)
 * - the same "the argument is the remainder by definition" rule
 * RULES-AND-LEARNED-COMPONENTS.md names for these patterns, applied
 * generically instead of per-package special-casing. A manifest with no
 * required argument (an argument-less command like "what time is it")
 * never reaches this: matchPattern's own captured text is empty for a
 * whole-string pattern. */
function firstRequiredArg(manifest: { args?: { required?: string[] } }): string {
  return manifest.args?.required?.[0] ?? "expression";
}
