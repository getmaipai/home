// Image app shelves read templates and files through their existing access boundaries.
import { listLibrary } from "@/lib/library";
import { listTemplates } from "@/lib/media/templates";
import { templateCoverUrl } from "@/lib/templateCovers";
import { registerAppData, registerAppPageFill } from "@/lib/apps";
import { pictureFragmentChips } from "@/lib/media/pictureFragments";
import { studioOperationRows, studioPickerRows, studioRows } from "@/lib/mediaOps/studio";
import { attachments, pictureJobs } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { getPictureJob } from "@/lib/pictures/jobStore";
import { typicalWait } from "@/lib/pictures/quality";
import { peekPictureEngineStatus, pictureReferenceLimit } from "@/lib/pictures/ready";
import { pictureJobLockState } from "@/lib/pictures/lock";
import { lockItemOfProvenance, lockState } from "@/lib/adultLock";
import { pictureActivityItem } from "@/lib/activity";
import { listCast } from "@/lib/cast";
import { getMediaSubject, isSheetReference } from "@/lib/mediaSubjects";
import type { PersonRow } from "@/types";

/** CREATOR-19: the viewer's saved characters. `listCast` already drops adult-only entries and real-person likenesses for a minor, so the filter is the one place that rule lives. */
function characterRows(person: PersonRow) {
  return listCast(person).filter((entry) => entry.kind === "subject" && entry.subject_kind === "character" && entry.subject_id).map((entry) => {
    const subject = getMediaSubject(person, entry.subject_id!);
    const first = (subject?.reference_ids ?? []).find((id) => {
      const file = db.select({ provenance: attachments.provenance }).from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt))).get();
      return !!file && !isSheetReference(file.provenance);
    });
    const count = (subject?.reference_ids ?? []).length;
    return { id: entry.id, title: entry.name, subtitle: count > 0 ? `Character, ${count} ${count === 1 ? "picture" : "pictures"}` : "Character", thumbnail: first ? `/api/files/${first}/thumb?w=320` : "" };
  });
}

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
    if (lock === "locked") return [{ id: `picture-job:${id}`, title: "Locked picture", subtitle: "Unlock your adult items to see it.", thumbnail: "", kind: "image", created_at: job.updatedAt, progress: null, badge: "Locked", meta: "", making: job.state === "queued" || job.state === "running" }];
    if (job.state === "done" && job.files.length) return [];
    const activity = pictureActivityItem(person, job);
    if (!activity) return [];
    return [{ id: `picture-job:${id}`, title: activity.title, subtitle: activity.line ?? (activity.state === "done" ? "Done" : ""), thumbnail: "", kind: "image", created_at: job.updatedAt, progress: activity.percent === null ? null : activity.percent / 100, badge: activity.state === "waiting" ? "Waiting" : activity.state === "making" ? "Making" : activity.state === "failed" ? "Failed" : activity.state === "done" ? "Done" : "", meta: "", making: activity.state === "waiting" || activity.state === "making" }];
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
      return { id: `picture-job:${note.job}`, fileId: file.id, title: "Locked picture", subtitle: "Unlock your adult items to see it.", thumbnail: "", kind: "image", created_at: file.createdAt, progress: null, badge: "Locked", meta: "", making: false };
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
  if (dataId === "templates") return listTemplates({ actor: person, kind: "picture" }).map((template) => ({ id: template.id, title: template.title, subtitle: template.summary, summary: template.summary, thumbnail: templateCoverUrl(template.id) }));
  if (dataId === "characters") return characterRows(person);
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
/** The last 20 finished pictures of a level, as the time each took (the sum of its files' ms). A job stored before ms was kept is skipped. */
function levelWaitMs(level: "standard" | "boost" | "max"): number[] {
  const rows = db.select({ request: pictureJobs.request, files: pictureJobs.files }).from(pictureJobs).where(eq(pictureJobs.state, "done")).orderBy(desc(pictureJobs.updatedAt)).limit(400).all();
  const out: number[] = [];
  for (const row of rows) {
    try {
      const request = JSON.parse(row.request) as { tier?: string };
      if ((request.tier ?? "standard") !== level) continue;
      const files = JSON.parse(row.files) as Array<{ ms?: number | null }>;
      const ms = files.reduce((sum, file) => sum + (typeof file.ms === "number" ? file.ms : 0), 0);
      if (ms > 0) out.push(ms);
    } catch { /* a malformed row is skipped */ }
    if (out.length >= 20) break;
  }
  return out;
}

registerAppPageFill("image", "create", (person, page) => {
  const bar = findPromptBar(page.body);
  if (!bar) return;
  bar.placeholder = 'Describe the picture. Put exact words in quotes, like "Summer Fair". Type @ to add someone from your cast.';
  const tier = bar.tier as { tiers?: Array<{ id?: string; hint?: string }> } | undefined;
  for (const item of tier?.tiers ?? []) {
    if (item.id === "standard") item.hint = "Fast.";
    if (item.id === "boost" || item.id === "max") item.hint = "More detail.";
    if (item.id === "standard" || item.id === "boost" || item.id === "max") {
      const wait = typicalWait(levelWaitMs(item.id));
      if (wait && item.hint) item.hint = `${item.hint} ${wait}`;
    }
  }
  const reference = Array.isArray(bar.references) ? (bar.references as Array<Record<string, unknown>>).find((item) => item.state === "reference") : undefined;
  // The composer slot holds at most 3 (spec prompt_bar.references.max); the engine may take fewer.
  const engine = peekPictureEngineStatus();
  if (reference) reference.max = engine ? Math.min(3, pictureReferenceLimit(engine)) : 3;
  const templates = listTemplates({ actor: person, kind: "picture" });
  const templateState = page.state && typeof page.state === "object" ? (page.state as Record<string, unknown>).template : undefined;
  const selectedTemplate = typeof templateState === "string" ? templates.find((item) => item.id === templateState) : undefined;
  const firstBlank = selectedTemplate?.prompt.match(/\{\{[a-z][a-z0-9_]*\|([^|}]+)\|[^}]*\}\}/)?.[1]?.toLowerCase();
  if (selectedTemplate && firstBlank) bar.placeholder = `Describe your ${firstBlank}. Other fields use the template's example.`;
  const existing = Array.isArray(bar.chips) ? bar.chips as unknown[] : [];
  const templateChip = {
    state: "template", label: "Template", group: "Template", icon: "sparkles", icon_only: true,
    presentation: "popover", default: "none", quiet_value: "none",
    options: [{ value: "none", label: "No template" }, ...templates.map((template) => ({ value: template.id, label: template.title }))],
  };
  const call = (bar.submit as { call?: { args?: Record<string, unknown> } } | undefined)?.call;
  const shelf = findRecentShelf(page.body);
  if (shelf) {
    shelf.item_badge_field = "badge";
    shelf.item_meta_field = "meta";
    shelf.item_progress_field = "progress";
    shelf.making_field = "making";
    shelf.poll_while = { field: "making", values: ["yes"] };
  }
  if (call?.args) call.args.template = "{template}";
  const chips = pictureFragmentChips(person);
  if (chips.length === 0) { bar.chips = [...existing, templateChip]; return; }
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
  bar.chips = [...existing, templateChip, ...chips.map((chip) => ({ state: chip.id, label: chip.label, group: "Style", icon: chip.id.startsWith("look_") ? "palette" : "sparkles", icon_only: true, presentation: "popover", default: "none", quiet_value: "none", options: chip.options }))];
  if (call?.args) for (const chip of chips) call.args[chip.id] = `{${chip.id}}`;
});
registerAppPageFill("image", "index", (_person, page) => {
  const shelf = findRecentShelf(page.body);
  if (!shelf) return;
  shelf.item_badge_field = "badge";
  shelf.item_meta_field = "meta";
  shelf.item_progress_field = "progress";
  shelf.making_field = "making";
  shelf.making_field = "making";
  shelf.poll_while = { field: "making", values: ["yes"] };
});
registerAppPageFill("image", "recent", (_person, page) => {
  const shelf = findRecentShelf(page.body);
  if (!shelf) return;
  shelf.item_badge_field = "badge";
  shelf.item_meta_field = "meta";
  shelf.item_progress_field = "progress";
  shelf.making_field = "making";
  shelf.poll_while = { field: "making", values: ["yes"] };
});
registerAppPageFill("image", "creations", (_person, page) => {
  const shelf = findRecentShelf(page.body);
  if (!shelf) return;
  shelf.item_badge_field = "badge";
  shelf.item_meta_field = "meta";
  shelf.item_progress_field = "progress";
  shelf.making_field = "making";
  shelf.poll_while = { field: "making", values: ["yes"] };
});
function findRecentShelf(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) { for (const item of value) { const hit = findRecentShelf(item); if (hit) return hit; } return undefined; }
  if (!value || typeof value !== "object") return undefined;
  const node = value as Record<string, unknown>;
  if (node.type === "media_shelf" && (node.bind as { path?: unknown } | undefined)?.path === "recent") return node;
  for (const child of Object.values(node)) { const hit = findRecentShelf(child); if (hit) return hit; }
  return undefined;
}
function findPromptBar(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) { for (const item of value) { const hit = findPromptBar(item); if (hit) return hit; } return undefined; }
  if (!value || typeof value !== "object") return undefined;
  const node = value as Record<string, unknown>;
  if (node.type === "prompt_bar") return node;
  for (const child of Object.values(node)) { const hit = findPromptBar(child); if (hit) return hit; }
  return undefined;
}
