// ELEMENTS-HOME-01: the Elements app (package id `elements`; not a kit Element part) lists characters, places and props through the ONE cast resolver.
// `listCast` already drops adult-only entries and real-person likenesses for a minor and lists companions and household members the way the @ picker does,
// so this file filters and shapes rows and holds no rule of its own.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { registerAppData } from "@/lib/apps";
import { listCast, type CastEntry } from "@/lib/cast";
import { getMediaSubject, isSheetReference, type SubjectKind } from "@/lib/mediaSubjects";
import { elementActions, elementEditRows, elementFacts, elementFilms, elementPictures } from "@/lib/elementsDetail";
import type { PersonRow } from "@/types";

const KIND_LABEL: Record<SubjectKind, string> = { character: "Character", place: "Place", prop: "Prop" };
const KINDS = new Set<string>(["character", "place", "prop"]);

/** The first picture the person saved for an element (never its generated reference sheet), as a Library thumbnail URL. */
function thumbnailOf(entry: CastEntry, person: PersonRow): string {
  const subject = entry.subject_id ? getMediaSubject(person, entry.subject_id) : null;
  const first = (subject?.reference_ids ?? []).find((id) => {
    const file = db.select({ provenance: attachments.provenance }).from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt))).get();
    return !!file && !isSheetReference(file.provenance);
  });
  return first ? `/api/files/${first}/thumb?w=320` : entry.avatar.url ?? "";
}

/** One row per element the viewer may cast; `kind` narrows to character, place or prop, `query` matches the name (case-insensitive). */
export function elementRows(person: PersonRow, input: { kind?: string; query?: string } = {}) {
  const kind = input.kind && KINDS.has(input.kind) ? input.kind : "";
  const query = (input.query ?? "").trim().toLocaleLowerCase();
  return listCast(person)
    .filter((entry) => (!kind || entry.subject_kind === kind) && (!query || entry.name.toLocaleLowerCase().includes(query)))
    .map((entry) => {
      const count = (entry.subject_id ? getMediaSubject(person, entry.subject_id)?.reference_ids.length : 0) ?? 0;
      const label = KIND_LABEL[entry.subject_kind];
      return { id: entry.id, title: entry.name, subtitle: count > 0 ? `${label}, ${count} ${count === 1 ? "picture" : "pictures"}` : label, thumbnail: thumbnailOf(entry, person), kind: entry.subject_kind };
    });
}

export function elementsAppData(person: PersonRow, dataId: string, body: unknown): unknown | null {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const pick = (value: unknown) => typeof value === "string" ? value : undefined;
  const id = pick(input.id) ?? "";
  if (dataId === "element") return elementFacts(person, id);
  if (dataId === "element-pictures") return elementPictures(person, id);
  if (dataId === "element-films") return elementFilms(person, id);
  if (dataId === "element-actions") return elementActions(person, id);
  if (dataId === "element-edit") return elementEditRows(person, id);
  if (dataId !== "elements") return null;
  return elementRows(person, { kind: pick(input.kind), query: pick(input.query) });
}

registerAppData("elements", elementsAppData);
