// Image app shelves read templates and files through their existing access boundaries.
import { listLibrary } from "@/lib/library";
import { listTemplates } from "@/lib/media/templates";
import { registerAppData, registerAppPageFill } from "@/lib/apps";
import { pictureFragmentChips } from "@/lib/media/pictureFragments";
import { studioOperationRows, studioPickerRows, studioRows } from "@/lib/mediaOps/studio";
import { attachments, pictureJobs } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { getPictureJob } from "@/lib/pictures/jobStore";
import { pictureJobLockState } from "@/lib/pictures/lock";
import { lockItemOfProvenance, lockState } from "@/lib/adultLock";
import { jobQueueCopy, plainStageLabel } from "@/lib/jobQueueCopy";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";

const rows = (person: PersonRow, body: unknown, madeOnly = false) => {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const limit = Math.min(60, Math.max(1, Number.isInteger(input.limit) ? Number(input.limit) : 20));
  const page = listLibrary(person, { type: "image", ...(madeOnly ? { origin: "made" as const } : {}), sort: "newest", limit });
  const finished = page.items.map((file) => ({ id: file.id, title: file.name, subtitle: file.owner.display_name, thumbnail: file.thumb_url, kind: "image", created_at: file.created_at, progress: null, badge: "", meta: "" }));
  if (!madeOnly) return finished;
  const jobs = db.select({ id: pictureJobs.id, state: pictureJobs.state, files: pictureJobs.files }).from(pictureJobs).where(and(eq(pictureJobs.personId, person.id), isNull(pictureJobs.purpose), isNull(pictureJobs.conversationId))).orderBy(desc(pictureJobs.updatedAt)).limit(60).all();
  const making = jobs.flatMap((row) => {
    const { id } = row;
    const job = getPictureJob(person, id);
    if (!job || job.conversationId) return [];
    const lock = pictureJobLockState(person, job);
    if (lock === "hidden") return [];
    if (lock === "locked") return [{ id: `picture-job:${id}`, title: "Locked picture", subtitle: "Unlock your adult items to see it.", thumbnail: "", kind: "image", created_at: job.updatedAt, progress: null, badge: "Locked", meta: "" }];
    if (job.state === "done" && job.files.length) return [];
    const audience = speakerAgeBand(person, new Date()) === "child" ? "child" : "adult";
    const line = job.state === "queued" ? jobQueueCopy("queued", "queue", job.position, null, audience)
      : job.state === "running" ? plainStageLabel(job.phase, audience) ?? "Making your picture."
      : job.state === "failed" ? job.error ?? "The picture did not finish. Try again."
      : "";
    const percent = job.state === "running" && job.percent > 0 ? Math.max(1, Math.min(99, Math.round(job.percent))) : null;
    return [{ id: `picture-job:${id}`, title: job.prompt, subtitle: line, thumbnail: "", kind: "image", created_at: job.updatedAt, progress: null, badge: percent === null ? "" : `${percent}%`, meta: "" }];
  });
  making.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const lockedFinished = db.select({ id: attachments.id, owner: attachments.ownerPersonId, provenance: attachments.provenance, createdAt: attachments.createdAt }).from(attachments)
    .where(and(eq(attachments.ownerPersonId, person.id), isNull(attachments.deletedAt))).all()
    .filter((file) => lockState(lockItemOfProvenance(file.owner, file.provenance), person) === "locked")
    .filter((file) => {
      try {
        const note = JSON.parse(file.provenance.slice(file.provenance.indexOf(":") + 1)) as { job?: string };
        const job = jobs.find((candidate) => candidate.id === note.job);
        return !!note.job && job?.state === "done" && getPictureJob(person, note.job)?.files.some((output) => output.id === file.id) === true;
      } catch { return false; }
    })
    .map((file) => {
      const note = JSON.parse(file.provenance.slice(file.provenance.indexOf(":") + 1)) as { job: string };
      return { id: `picture-job:${note.job}`, fileId: file.id, title: "Locked picture", subtitle: "Unlock your adult items to see it.", thumbnail: "", kind: "image", created_at: file.createdAt, progress: null, badge: "Locked", meta: "" };
    });
  const lockedIds = new Set(lockedFinished.map((file) => String(file.fileId)));
  const visibleFinished = finished.filter((file) => !lockedIds.has(String(file.id)));
  const lockedJobIds = new Set(lockedFinished.map((file) => String(file.id)));
  const lockRows = [...making.filter((file) => !lockedJobIds.has(String(file.id))), ...lockedFinished].map((file) => {
    const { fileId: _fileId, ...visible } = file as typeof file & { fileId?: string };
    return visible;
  }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return [...lockRows, ...visibleFinished];
};

export function imageAppData(person: PersonRow, dataId: string, body: unknown): unknown | null {
  if (dataId === "templates") return listTemplates({ actor: person, kind: "picture" }).map((template) => ({ id: template.id, title: template.title, subtitle: template.summary, summary: template.summary, thumbnail: null }));
  if (dataId === "library") return rows(person, body);
  if (dataId === "recent") return rows(person, body, true);
  // IMG-STUDIO-02: the Studio page. `studio` is the opened picture (one row, empty until a picture is chosen), `studio-tools` the registry's extra operations
  // for it, `studio-picker` the person's own pictures to choose from.
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (dataId === "studio") return studioRows(person, input);
  if (dataId === "studio-tools") return studioOperationRows(person, input);
  if (dataId === "studio-picker") return studioPickerRows(person, input);
  return null;
}

registerAppData("image", imageAppData);
/** CREATOR-13: the Create page's preset chips (Look by family, Light, Angle, Format), from the preset records. A Create page chip holds at most 24 options,
 * and each chip is its own popover (the kit's popover has no height limit, so one popover over all 79 options is 3,100 px tall and cannot be reached).
 * The composer's mode list reads this page's chips, so the Home ask box and every other composer show the same ones. */
registerAppPageFill("image", "create", (person, page) => {
  const bar = findPromptBar(page.body);
  if (!bar) return;
  const chips = pictureFragmentChips(person);
  if (chips.length === 0) return;
  const existing = Array.isArray(bar.chips) ? bar.chips as unknown[] : [];
  for (const item of existing) if (item && typeof item === "object") {
    const chip = item as Record<string, unknown>;
    if (chip.state === "shape") {
      chip.group = "Shape";
      chip.icon = "rectangle-horizontal";
      chip.icon_only = true;
      const icons: Record<string, string> = { square: "square", landscape: "rectangle-horizontal", portrait: "rectangle-vertical", wide: "monitor", tall: "smartphone" };
      if (Array.isArray(chip.options)) for (const option of chip.options as Array<Record<string, unknown>>) option.icon = icons[String(option.value)];
    }
    if (chip.state === "count") { chip.group = "Pictures"; chip.icon = "layers"; chip.icon_only = true; }
  }
  bar.chips = [...existing, ...chips.map((chip) => ({ state: chip.id, label: chip.label, group: "Style", icon: chip.id.startsWith("look_") ? "palette" : "sparkles", icon_only: true, presentation: "popover", default: "none", quiet_value: "none", options: chip.options }))];
  const call = (bar.submit as { call?: { args?: Record<string, unknown> } } | undefined)?.call;
  if (call?.args) for (const chip of chips) call.args[chip.id] = `{${chip.id}}`;
});
function findPromptBar(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) { for (const item of value) { const hit = findPromptBar(item); if (hit) return hit; } return undefined; }
  if (!value || typeof value !== "object") return undefined;
  const node = value as Record<string, unknown>;
  if (node.type === "prompt_bar") return node;
  for (const child of Object.values(node)) { const hit = findPromptBar(child); if (hit) return hit; }
  return undefined;
}
