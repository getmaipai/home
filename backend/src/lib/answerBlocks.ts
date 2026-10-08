import { AnswerBlock } from "@maipai/spec/gen/ts/answer-block.js";
import type { AnswerBlock as AnswerBlockValue } from "@maipai/spec/gen/ts/answer-block.js";
import type { AgeBand } from "@/lib/ageBand";
import { evaluateSafety, forOutput } from "@/lib/safety";
import { carriesCrisisSignal } from "@/lib/safety";
import { notifyIfFlagged } from "@/lib/notifications";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { PersonRow } from "@/types";

const BAND_RANK: Record<AgeBand, number> = { child: 0, teen: 1, adult: 2 };
const STRUCTURAL_KEYS = new Set([
  "id", "src", "url", "href", "kind", "schema_version", "producer",
  "created_at", "hlc", "min_band", "status", "when", "align", "direction",
]);

function* humanStrings(value: unknown, key = ""): Generator<string> {
  if (typeof value === "string") {
    if (!STRUCTURAL_KEYS.has(key)) yield value;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) yield* humanStrings(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) yield* humanStrings(child, childKey);
  }
}

function hubImageSources(block: AnswerBlockValue): boolean {
  if (block.kind !== "image_gallery") return true;
  const props = block.props as { images?: Array<{ src?: string }> };
  return props.images?.every((image) => {
    const source = image.src;
    if (typeof source !== "string") return false;
    try {
      const url = new URL(source, "https://home.invalid");
      return url.origin === "https://home.invalid"
        && /^\/api\/answer-image\/ai_[a-f0-9]{32}$/.test(url.pathname)
        && ["tile", "full"].includes(url.searchParams.get("v") ?? "");
    } catch {
      return false;
    }
  }) ?? false;
}

/** Validate package blocks, enforce the manifest allowlist and apply the
 * same age band and output classifier used for prose. A rejected visual is
 * dropped independently; it never changes the package reply. */
export function filterAnswerBlocks(
  raw: unknown,
  packageId: string,
  allowedKinds: readonly string[],
  band: AgeBand,
  actor: Pick<PersonRow, "displayName">,
  seenIds: ReadonlySet<string> = new Set(),
  onCrisisSignal?: (safety: SafetyResult) => void,
): AnswerBlockValue[] {
  if (!Array.isArray(raw)) return [];
  const accepted: AnswerBlockValue[] = [];
  const ids = new Set(seenIds);

  for (const candidate of raw) {
    const parsed = AnswerBlock.safeParse(candidate);
    if (!parsed.success) {
      console.warn("[answer-block] dropped invalid block");
      continue;
    }
    const block = parsed.data as AnswerBlockValue;
    if (block.producer !== packageId || !allowedKinds.includes(block.kind) || ids.has(block.id)) {
      console.warn("[answer-block] dropped block outside package manifest");
      continue;
    }
    if (!hubImageSources(block)) {
      console.warn("[answer-block] dropped image block outside hub cache");
      continue;
    }
    if (block.min_band && BAND_RANK[band] < BAND_RANK[block.min_band as AgeBand]) continue;

    let refused = false;
    const flagged: { notify_parent: boolean; categories: string[] } = { notify_parent: false, categories: [] };
    for (const text of humanStrings({ alt: block.alt, provenance: block.provenance, props: block.props })) {
      const safety = forOutput(evaluateSafety(text, band));
      if (carriesCrisisSignal(safety)) onCrisisSignal?.(safety);
      if (safety.flagged) {
        flagged.notify_parent ||= safety.notify_parent;
        flagged.categories.push(...safety.categories);
      }
      if (safety.action === "refuse") refused = true;
    }
    if (flagged.notify_parent) notifyIfFlagged(actor, { ...flagged, categories: [...new Set(flagged.categories)] }, "[answer-block]");
    if (refused) {
      console.warn("[answer-block] dropped block at output floor");
      continue;
    }
    ids.add(block.id);
    accepted.push(block);
  }
  return accepted;
}
