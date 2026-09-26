// PROJECT-RUN-01, the mandatory `gate` (design record, "The step
// vocabulary" and "Safety, permissions, privacy"): every artifact
// crosses the same output-safety floor a turn's own reply does
// (lib/turnMachine/nodes/outputGate.ts calls evaluateReply() over the
// composed reply; this is the identical call over a project's composed
// artifact text) - SAFETY.md's non-removable architecture, so the
// runner calls this unconditionally after every text/assemble step,
// never only when a recipe happens to declare a `gate` step.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { evaluateReply } from "@/lib/safety";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";

export interface GateVerdict {
  gate: "passed" | "failed";
  /** Plain words, set only when refused - never the flagged text itself
   * (safety.ts's own "logged with the fact, never the transcript"). */
  reason?: string;
}

function personRowFor(personId: string): PersonRow | null {
  return db.select().from(people).where(eq(people.id, personId)).get() ?? null;
}

/** `personId` missing (a deleted person, a bad provenance) reads as the
 * strictest band rather than throwing - a gate check must never itself
 * be the reason an artifact silently skips safety. */
export function gateText(personId: string, text: string): GateVerdict {
  const person = personRowFor(personId);
  const band = person ? speakerAgeBand(person, new Date()) : "child";
  const evaluation = evaluateReply({ text }, band);
  if (evaluation.effective.action === "refuse") {
    const categories = evaluation.effective.categories.join(", ") || "unspecified";
    return { gate: "failed", reason: `the output-safety gate refused this artifact (categories: ${categories})` };
  }
  return { gate: "passed" };
}
