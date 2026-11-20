// MODELPACK-HOME-02: what the Stack's jobs catalog says about the picture jobs, in the shape the picture code branches on. Home reads
// capabilities and limits here and never names a model: a part is an opaque id the Stack gave, and "can it spell words" is the catalog's
// `capabilities.text` (chat rule W2's `text: true` mark), not a list in Home. Readiness stays in the parts list and the role health (rule S6).
import type { StackJobLevel, StackJobShape, StackJobsCatalogRead } from "@/lib/stack/jobsCatalogShape";

/** The two lists a job is asked for: an adult's (the household's order) and a minor's (neutral labels, the Stack's own priority). */
export type PictureList = "adult" | "minor";

export interface PictureJobView {
  /** An enabled, ready part in this list serves the job now. */
  available: boolean;
  /** The part that would serve it (an opaque id and the label to print), or null. */
  part: { id: string; label: string } | null;
  /** The part shown spells words (`capabilities.text`). */
  text: boolean;
  /** The other parts of this list that serve the job, in the order a job would pick them (an adult's catalog only: a minor's carries none). */
  alternatives: Array<{ part: string; label: string }>;
  /** Pixel sizes per shape and level for the part shown. A shape that is absent is not served. */
  shapes: NonNullable<NonNullable<StackJobsCatalogRead["jobs"][number]["limits"]>["shapes"]>;
  maxReferences: number | null;
}

export function pictureJobView(catalog: StackJobsCatalogRead, job: "picture" | "picture_edit"): PictureJobView | null {
  const entry = catalog.jobs.find((item) => item.job === job);
  if (!entry) return null;
  return {
    available: entry.available === true,
    part: entry.part ?? null,
    text: entry.capabilities?.text === true,
    alternatives: entry.alternatives ?? [],
    shapes: entry.limits?.shapes ?? {},
    maxReferences: typeof entry.limits?.max_references === "number" ? entry.limits.max_references : null,
  };
}

/** Whether the part the catalog shows serves this shape at this level. */
export const servesShape = (view: PictureJobView, shape: StackJobShape, level: StackJobLevel): boolean => Boolean(view.shapes[shape]?.[level]);

/**
 * Whether a picture that must show words can start on the part the catalog shows: it is on and it spells words (rule W1). A part that does not
 * spell is never asked for words; when another part in the list might, the caller asks the generic job and the Stack picks. A catalog that
 * cannot be read refuses nothing on a guess.
 */
export function wordsCanStart(view: PictureJobView | null): boolean {
  if (!view) return true;
  return view.available && view.text;
}

/** Whether a picture with no words needs the "no text" sentence (rule W2): the catalog does not mark the part `text: true`. An unreadable catalog says nothing, so nothing is added. */
export const needsNoTextLine = (view: PictureJobView | null): boolean => view !== null && view.available && !view.text;

/**
 * The parts to try for a re-make after the one that ran (rule W4): the part shown first, then the alternatives, starting after the one that
 * ran and wrapping, never the one that ran unless it is the only one. The Stack's refusal decides which of them can spell (rule W1).
 */
export function partsAfter(view: PictureJobView | null, ran: string | null): string[] {
  if (!view?.part) return [];
  const order = [view.part.id, ...view.alternatives.map((alt) => alt.part).filter((id) => id !== view.part!.id)];
  const at = ran ? order.indexOf(ran) : -1;
  const rotated = at < 0 ? order : [...order.slice(at + 1), ...order.slice(0, at + 1)];
  return rotated.length > 1 ? rotated.filter((id) => id !== ran) : rotated;
}
