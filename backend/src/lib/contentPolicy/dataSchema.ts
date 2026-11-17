import { z } from "zod";
import { foldTerm } from "@maipai/spec/safety/ts/fold.js";

// Use the matcher's own term folding, including its punctuation removal.
export const policyWord = z.string().min(1).max(100).refine(value => foldTerm(value).trim().length > 0, "Policy entries must have a nonempty folded matcher");
const list = z.array(policyWord).min(1);
/** CONTENT-POLICY-03: which unsafe words a child's request may have rewritten once instead of refused: `scary` (spooky, not graphic) and `pretend_fight` (a
 * pretend fight or toy weapon). A term in CHILD_UNSAFE_TERMS in neither class is `hard`: it keeps the fixed line and is never rewritten. Every `scary` and `pretend_fight` term is
 * also in CHILD_UNSAFE_TERMS; `hard` adds a few inflections of words already there ("stabbed" beside "stab", "stabbing"), held for a child and never rewritten. */
const unsafeClasses = z.object({ scary: list, pretend_fight: list, hard: list }).strict();
export const lanesSchema = z.object({ version: z.literal(1), CHILD_UNSAFE_TERMS: list, CHILD_IP_NAMES: list, CHILD_UNSAFE_CLASSES: unsafeClasses }).strict()
  .superRefine((value, ctx) => {
    const known = new Set(value.CHILD_UNSAFE_TERMS);
    for (const term of [...value.CHILD_UNSAFE_CLASSES.scary, ...value.CHILD_UNSAFE_CLASSES.pretend_fight]) {
      if (!known.has(term)) ctx.addIssue({ code: "custom", message: `Class term "${term}" must also be in CHILD_UNSAFE_TERMS` });
    }
  });
export const floorsSchema = z.object({ version: z.literal(1), MINOR_MARKERS: list, SEXUAL_WORDS: list, UNCLOTHED_PHRASES: list }).strict();
