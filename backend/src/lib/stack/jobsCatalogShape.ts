// The part of GET /stack/v1/jobs/catalog Home reads: for each job, the part that serves it now, the others that could (the adult
// catalog's `alternatives`, in the order a job would pick them), the job's limits and its capabilities. The enums and the shape of each
// limit come from `@maipai/spec` (`StackJobsCatalog`, spec-v0.1.424); this read is tolerant on purpose: `limits` and `capabilities` are
// optional so a test double that serves only the parts still types, and an older Stack's entry still reads. It names no model: ids and
// labels are the Stack's.
import type { z } from "zod";
import type { StackJobLevel as StackJobLevelSchema, StackJobShape as StackJobShapeSchema } from "@maipai/spec/stack/ts/stack-model-pack.js";
import type { StackJobsCatalog } from "@maipai/spec/stack/ts/stack-jobs-catalog.js";

export type StackJobLevel = z.infer<typeof StackJobLevelSchema>;
export type StackJobShape = z.infer<typeof StackJobShapeSchema>;
type SpecEntry = StackJobsCatalog["jobs"][number];
export interface StackJobsCatalogRead {
  audience: StackJobsCatalog["audience"];
  jobs: Array<{
    job: string;
    available: boolean;
    part: SpecEntry["part"];
    alternatives?: Array<{ part: string; label: string }>;
    limits?: Partial<Pick<SpecEntry["limits"], "levels" | "max_references" | "max_words" | "shapes">>;
    /** `text`: the part spells words (chat rule W2's `text: true` mark). */
    capabilities?: { text: boolean } & Partial<Omit<SpecEntry["capabilities"], "text">>;
    /** The optional request keys this Stack's generic door accepts for the job (absent on an older Stack). */
    request_fields?: string[];
  }>;
}
