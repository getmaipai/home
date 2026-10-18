import { z } from "zod";
import { foldTerm } from "@maipai/spec/safety/ts/fold.js";

// Use the matcher's own term folding, including its punctuation removal.
export const policyWord = z.string().min(1).max(100).refine(value => foldTerm(value).trim().length > 0, "Policy entries must have a nonempty folded matcher");
const list = z.array(policyWord).min(1);
export const lanesSchema = z.object({ version: z.literal(1), CHILD_UNSAFE_TERMS: list, CHILD_IP_NAMES: list }).strict();
export const floorsSchema = z.object({ version: z.literal(1), MINOR_MARKERS: list, SEXUAL_WORDS: list, UNCLOTHED_PHRASES: list }).strict();
