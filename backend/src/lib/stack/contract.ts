/** Stack's additive /healthz contract accepted by this Home build. */
export const STACK_CONTRACT_MIN = 1;
export const STACK_CONTRACT_MAX = 1;
import { z } from "zod";
import type { StackCodingMode } from "./types";
export const StackCodingModeSchema = z.object({
  mode: z.enum(["normal", "coding"]), target: z.enum(["normal", "coding"]), state: z.enum(["stable", "switching", "failed"]),
  reason: z.string().nullable(), available: z.boolean(),
  checks: z.object({ engine: z.boolean(), pieces: z.boolean(), hardware: z.boolean(), memory: z.boolean(), bench: z.boolean() }),
  self_test: z.object({ passed_at: z.string().nullable(), stale: z.boolean() }),
  memory: z.object({ plan_bytes: z.number(), budget_bytes: z.number() }),
}) satisfies z.ZodType<StackCodingMode>;
