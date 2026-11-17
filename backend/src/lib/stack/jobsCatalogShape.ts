// The part of GET /stack/v1/jobs/catalog Home reads: for each job, the part that serves it now and the others that could (the adult
// catalog's `alternatives`, in the order a job would pick them). Hand-copied from `StackJobsCatalog` in `@maipai/spec` (MODELPACK-SPEC-01,
// spec-v0.1.423); deleted by HOME-PARTS-01 when the pin moves and the client is generated. It names no model: ids and labels are the Stack's.
export interface StackJobsCatalogRead {
  audience: "adult" | "minor";
  jobs: Array<{
    job: string;
    available: boolean;
    part: { id: string; label: string } | null;
    alternatives?: Array<{ part: string; label: string }>;
  }>;
}
