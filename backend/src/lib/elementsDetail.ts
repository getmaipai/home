// ELEMENTS-HOME-02: what the detail page of one element shows. Everything is read through the one cast resolver's list (`listCast`), so an element the
// viewer may not cast (an adult-only one for a minor, a real-person likeness for a minor) is simply not found, never shown locked (C10).
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { filmRuns } from "@/db/schema";
import { listCast, type CastEntry } from "@/lib/cast";
import { getMediaSubject, isSheetReference } from "@/lib/mediaSubjects";
import { attachments } from "@/db/schema";
import { and, isNull } from "drizzle-orm";
import type { PersonRow } from "@/types";

const EMPTY = "Not set yet";
export const entryFor = (person: PersonRow, id: string): CastEntry | null => listCast(person).find((entry) => entry.id === id) ?? null;
/** Rename and Delete are for the owner's own saved elements: a companion or a household member is one personality record, edited where that record is. */
const editable = (person: PersonRow, entry: CastEntry): boolean => {
  const subject = entry.subject_id ? getMediaSubject(person, entry.subject_id) : null;
  return !!subject && subject.owner_person_id === person.id && !subject.synth_id && !subject.person_id && entry.kind === "subject";
};

/** Label and value rows: every field shows its value or says plainly that it is empty. */
export function elementFacts(person: PersonRow, id: string) {
  const entry = entryFor(person, id);
  if (!entry) return [];
  const sheet = entry.look.sheet_file_id ? (entry.look.sheet_stale ? "Made, but its pictures have changed since" : "Made") : "Not made yet";
  const linked = entry.kind === "synth" ? "A companion" : entry.kind === "member" ? "A household member" : "Saved by you";
  return [
    { id: "kind", label: "Kind", value: `${entry.subject_kind === "character" ? "Character" : entry.subject_kind === "place" ? "Place" : "Prop"}. ${linked}.` },
    { id: "look", label: "Look", value: entry.look.description.trim() || EMPTY },
    { id: "locked", label: "Locked description", value: entry.locked_description?.trim() || EMPTY },
    { id: "sheet", label: "Reference sheet", value: sheet },
    { id: "voice", label: "Voice", value: entry.voice?.trim() || EMPTY },
  ];
}

/** The element's own saved pictures (never its generated sheet), as Library thumbnails. */
export function elementPictures(person: PersonRow, id: string) {
  const entry = entryFor(person, id);
  const subject = entry?.subject_id ? getMediaSubject(person, entry.subject_id) : null;
  if (!entry || !subject) return [];
  return subject.reference_ids.flatMap((fileId) => {
    const file = db.select({ provenance: attachments.provenance }).from(attachments).where(and(eq(attachments.id, fileId), isNull(attachments.deletedAt))).get();
    return file && !isSheetReference(file.provenance) ? [{ id: fileId, title: entry.name, thumbnail: `/api/files/${fileId}/thumb?w=320` }] : [];
  });
}

/** The viewer's own films whose cast (or shots) names this element. Only films the viewer can already open are named. */
export function elementFilms(person: PersonRow, id: string) {
  const entry = entryFor(person, id);
  if (!entry?.subject_id) return [];
  const subjectId = entry.subject_id;
  return db.select().from(filmRuns).where(eq(filmRuns.personId, person.id)).all().flatMap((run) => {
    if (!run.planJson) return [];
    try {
      const saved = JSON.parse(run.planJson) as { plan?: unknown };
      const plan = (saved.plan ?? saved) as { title?: string; cast?: Array<{ subject_id?: string }>; shots?: Array<{ subject_ids?: string[] }> };
      return plan.cast?.some((member) => member.subject_id === subjectId) || plan.shots?.some((shot) => shot.subject_ids?.includes(subjectId)) ? [{ id: run.id, title: plan.title?.trim() || run.idea.slice(0, 60), subtitle: run.state === "done" ? "Finished" : "In progress" }] : [];
    } catch { return []; }
  });
}

/** One row for the page's action bar: `reason` is empty when the look can be captured now; `edit` rows exist only where Rename and Delete are offered. */
export function elementActions(person: PersonRow, id: string) {
  const entry = entryFor(person, id);
  if (!entry) return [];
  const subject = entry.subject_id ? getMediaSubject(person, entry.subject_id) : null;
  const reason = entry.subject_kind !== "character" ? "A look is captured for characters." : !subject ? "Save this one as an element first." : subject.owner_person_id !== person.id ? "Only the person who saved this can capture its look." : "";
  return [{ id, reason }];
}
export function elementEditRows(person: PersonRow, id: string) {
  const entry = entryFor(person, id);
  return entry && editable(person, entry) ? [{ id, title: entry.name, thumbnail: "", subtitle: "Delete this element. Pictures and films that used it keep working." }] : [];
}
export const canEditElement = (person: PersonRow, id: string): boolean => { const entry = entryFor(person, id); return !!entry && editable(person, entry); };
