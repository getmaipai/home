import { z } from "zod";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome, TurnState } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { refuseVideoPrompt, VIDEO_REFUSAL_LINE } from "@/lib/videos/policy";
import { startFilm } from "./background";

export const MAKE_FILM_TOOL_ID = "make_film";
export const makeFilmArgs = z.object({
  idea: z.string().trim().min(3).max(4000),
  shots: z.number().int().min(4).max(12).optional(),
  look: z.string().trim().min(1).max(160).optional(),
  characters: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  go_ahead: z.boolean().optional(),
});

type FilmState = Pick<TurnState, "actor" | "surface" | "planBasis" | "temporary">;
type Starter = typeof startFilm;
let starter: Starter = startFilm;
export function __setStartFilmForTests(fn: Starter | null): void { starter = fn ?? startFilm; }

function refused(callId: string, args: Record<string, unknown>, line: string, why: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: MAKE_FILM_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: { reply: { text: `No film was started. Say this to the person in your own words and keep its meaning: ${line}` }, data: { refused: why }, actions: [] } });
}
function failed(callId: string, args: Record<string, unknown>): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId: MAKE_FILM_TOOL_ID, status: "failed", via: "tool_call", args, errorCode: "bad_arguments", failureKind: "bad_arguments", durationMs: 0 });
}

export function runMakeFilm(input: { state: FilmState; args: Record<string, unknown>; callId: string; spoken: boolean }): ToolExecutionOutcome {
  const { state, args, callId } = input;
  const parsed = makeFilmArgs.safeParse(args);
  if (!parsed.success) return failed(callId, args);
  const { actor } = state;
  const idea = parsed.data.idea;
  const refusal = refuseVideoPrompt(idea, { lane: "adult" });
  if (refusal) return refused(callId, args, VIDEO_REFUSAL_LINE[refusal], refusal);
  const result = starter({ actor: actor as PersonRow, idea, shots: parsed.data.shots, look: parsed.data.look, castHints: parsed.data.characters, goAhead: parsed.data.go_ahead === true });
  if ("line" in result) return refused(callId, args, result.line, "not_started");
  const awaitingGo = parsed.data.go_ahead !== true;
  return outcomeOf({ callId, packageId: MAKE_FILM_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: { reply: { text: awaitingGo ? "The film is planned and waiting for the person to press Go." : "The film has started." }, data: { filmRunId: result.id, awaitingGo }, actions: [] } });
}
