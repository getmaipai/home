// The one finished-image check for anything that is not already a picture or video job: companion art, uploads and any new place that makes
// or accepts a picture or clip frames. Pictures, clips and edits go through `gateFinished` (laneGate.ts) with the job's own record; this is the
// same decision (apparent age for everyone, the child lane's cartoon and safety question on top, a check that cannot run withholds) for a
// list of images with no job, with a verdict cache keyed by the image's sha256 so a file is looked at once.
import { createHash } from "node:crypto";
import { checkImages, recordWithheld, type CheckedKind, type ImageCheck } from "./ageCheck";
import { checkChildSafety, childSafetyOk, decideForLane, type ChildSafetyCheck } from "./laneGate";
import type { Lane } from "./lane";

export interface FinishedAsset {
  /** What the person sees in the reason, for example "The idle still". */
  label: string;
  /** Null or undefined when the file is missing or unreadable: the asset then fails closed. */
  bytes?: Uint8Array | null;
}

export type VerdictCache = Record<string, { age?: ImageCheck; child?: ChildSafetyCheck }>;

export interface FinishedCheckResult {
  ok: boolean;
  /** One plain sentence per problem, each saying what to do next. Empty when ok. */
  reasons: string[];
  /** True when a check could not run at all (no vision model, timeout, missing file): the item is withheld, but this is not a verdict on the picture, so a caller that sweeps should try again later. */
  unavailable: boolean;
}

const LANE_ORDER: readonly Lane[] = ["adult", "teen", "child"];
/** The stricter of two lanes: the check holds an item to whoever it is for and whoever asked for it. */
export function stricterLane(a: Lane, b: Lane): Lane { return LANE_ORDER.indexOf(a) >= LANE_ORDER.indexOf(b) ? a : b; }

export function sha256Of(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

export interface FinishedCheckInput {
  assets: readonly FinishedAsset[];
  lane: Lane;
  /** An adult-only item: any apparent minor withholds. */
  adultOnly: boolean;
  kind: CheckedKind;
  /** Verdicts already known, by sha256; gained verdicts are written back (a failed check is never cached). */
  cache?: VerdictCache;
  /** Who asked and what for: a withheld item is then reported to the admins (no image, rate limited) like a withheld picture. Omit for a sweep with no one asking. */
  report?: { personId: string; jobId: string };
}

export async function checkFinishedAssets(input: FinishedCheckInput): Promise<FinishedCheckResult> {
  const cache = input.cache ?? {};
  const reasons: string[] = [];
  const ageChecks: ImageCheck[] = [];
  const childChecks: ChildSafetyCheck[] = [];
  for (const asset of input.assets) {
    if (!asset.bytes) { reasons.push(`${asset.label} could not be checked because its file is missing or unreadable. Replace it or try again.`); continue; }
    const hash = sha256Of(asset.bytes);
    let age = cache[hash]?.age;
    if (!age) {
      try { [age] = await checkImages([asset.bytes], input.kind); } catch { age = undefined; }
      if (age?.ok) cache[hash] = { ...cache[hash], age };
    }
    ageChecks.push(age ?? { ok: false, why: "unavailable" });
    if (input.lane === "child") {
      let child = cache[hash]?.child;
      if (!child) {
        try { [child] = await checkChildSafety([asset.bytes]); } catch { child = undefined; }
        if (child?.ok) cache[hash] = { ...cache[hash], child };
      }
      childChecks.push(child ?? { ok: false, why: "unavailable" });
    }
  }
  if (ageChecks.length > 0) {
    const decision = decideForLane({ lane: input.lane, checks: ageChecks, adultOnly: input.adultOnly, kind: input.kind, ...(input.lane === "child" ? { childChecks } : {}) });
    if (decision.action === "withhold") {
      reasons.push(decision.line);
      if (input.report && (input.lane !== "adult" || decision.reason === "minor_sexual")) await recordWithheld({ kind: input.kind, personId: input.report.personId, jobId: input.report.jobId, adultOnly: input.adultOnly, checks: ageChecks });
    }
    if (input.lane === "child" && childChecks.some((check) => !childSafetyOk(check))) reasons.push("Some artwork could not be confirmed safe for children. Replace it or keep the audience teen or adult.");
  }
  const unavailable = input.assets.some((asset) => !asset.bytes) || ageChecks.some((check) => !check.ok) || childChecks.some((check) => !check.ok);
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], unavailable };
}
