// The part of POST /stack/v1/jobs/make that the picture jobs use. The request, result and refusal shapes are the spec's
// (`StackMakeRequest`, `StackMakeResult`, `StackMakeRefusal`, spec-v0.1.424); the result is read for the fields Home uses, and the route's own
// `not_available` answer, which the spec does not carry, is added to the refusals.
// It names no model: a `part` is an opaque id the Stack gave (the household's order or the catalog's `alternatives`).
import type { StackMakeRefusal, StackMakeRequest, StackMakeResult } from "@maipai/spec/stack/ts/stack-make.js";

/** `audience` is the list the job is asked for: an adult's (the household's order) or a minor's (neutral labels, shipped priority). */
export type StackMakeAudience = StackMakeRequest["audience"];
export type StackMakePictureRequest = Extract<StackMakeRequest, { job: "picture" }>;
export type StackMakeResultRead = Pick<StackMakeResult, "id" | "job" | "state" | "percent" | "status" | "files" | "poster" | "made_with">;
export type StackMakeRefusalRead = StackMakeRefusal | { code: "not_available"; line: string };
