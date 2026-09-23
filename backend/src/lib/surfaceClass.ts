// U4 (docs/plans/turn-machine-state-record-2026-09-22.md; RESP-01, folded
// into U4): the register follows the surface, declared once. A typed
// screen (chat, tv) gets the written register (full answers, structure,
// no act cap); voice (robot, pod, phone) keeps today's spoken register
// exactly; a shared glance surface (overlay) keeps the card. `spoken`
// forces the spoken class regardless of surface - a dictated chat turn
// (spoken input, typed screen) still gets the spoken register, since the
// person is listening, not reading; nothing sets it yet (no dictation
// marker exists today - RESP-01's own point 1), so this is plumbed and
// tested, ahead of a real caller.
import type { Surface } from "@/lib/turnEngine";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";

export type SurfaceClass = "written" | "spoken" | "glance";

export function surfaceClassOf(surface: Surface, spoken = false): SurfaceClass {
  if (spoken) return "spoken";
  if (surface === "chat" || surface === "tv") return "written";
  if (surface === "overlay") return "glance";
  return "spoken"; // robot, pod, phone
}

/** The reply floor (spec-v0.1.28, turn-machine-state-record-2026-09-22.md
 * "The reply floor", owner's rule 2026-09-23) is a written-class,
 * adult-only backstop, never a child's or teen's turn whatever the
 * surface. One shared predicate, reused everywhere a turn needs to
 * read as written-and-adult (persona.ts's WRITTEN_POLICY and
 * ENGAGEMENT_FRAGMENT_WRITTEN selection, register.ts's planLine's
 * length clause, nodes/model.ts's reply_ceiling_tokens) - a code
 * review (U4b-2) caught the persona side of this gated on surfaceClass
 * alone, contradicting nodes/model.ts's own age check: a child's chat
 * turn was told "never cut a genuinely complete answer short" while
 * still capped to a spoken-length token budget. */
export function isWrittenAdultTurn(surfaceClass: SurfaceClass | undefined, ageBand: TurnSignal["age_band"]): boolean {
  return (surfaceClass ?? "spoken") === "written" && ageBand === "adult";
}

/** TRUEUP-01 (a code review, 2026-09-23): the one place `contextToMessages()`
 * (messages.ts) and the phrasing round (nodes/model.ts) both resolve a
 * turn's own prompt-facing surface class - "written" only for the reply
 * floor's own written-adult turn, "spoken" otherwise (a minor's or a
 * teen's chat turn included) - so the prompt never promises a length or
 * a written-class instruction the token budget or the age band can't
 * back. Both call sites re-derived this identical ternary inline before
 * this helper existed, each with its own comment claiming "one
 * definition" while the code itself had two - a review caught the gap
 * between the claim and the code, not a live bug (both copies agreed),
 * but exactly the class of drift this item exists to prevent. */
export function promptSurfaceClassFor(surfaceClass: SurfaceClass | undefined, ageBand: TurnSignal["age_band"]): SurfaceClass {
  return isWrittenAdultTurn(surfaceClass, ageBand) ? "written" : "spoken";
}
