// VIDEO-LORA-07 (design 5.3, 15.4; docs/dev/lora-sources.md): installing a style an admin chose in the browser. Home never trusts a client's file address: it fetches the hit
// again from the source (`fetchHit`), classifies it, checks the licence step, duplicates and the audience rules, then asks the Stack for a `video.lora.install` job.
//
// Progress is the existing job list (RULES S6): one `jobs` row named "Downloading a style" (never the file's name, so an adult-only style is not named on the strip), kept
// current from the Stack job by `reconcileLoraInstalls`. What Home needs to finish the record (name, source, adult check, audience) lives ENCRYPTED in the row's provenance,
// opaque to the job list. A failure raises one Repairs item with Try again (plain cause, no name). On completion the `Lora` record is written (admin-only availability).
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { consumeTicket, unlockedFor, type AdultProof } from "@/lib/adultLock";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { raiseIssue, registerFixHandler, resolveIssue } from "@/lib/issues";
import { createJob, updateJob } from "@/lib/jobs";
import { readLora } from "@/lib/loras/access";
import { cleanTriggerWords, type AdultCheck } from "@/lib/loras/adultCheck";
import { installableBaseIds, isSupportedBase, mediaOfBase, supportedFamilyWords, type AnyBaseId, type Media } from "@/lib/loras/baseFamilies";
import { fetchHit, hitKey, installedAs, MAX_INSTALL_BYTES, SourceError, civitaiEnabled, tokenFor, parseHfLink, type Hit, type LoraSite } from "@/lib/loras/source";
import { getLoraRecord, listLoraRecords, saveLora, type Lora } from "@/lib/loras/store";
import { adoptPictureLoras, recordFromStack, syncLoras } from "@/lib/loras/sync";
import { getStackInstallJob, installStackLora, StackInstallRefused, StackVideoError, type StackLoraInstallBody, type StackVideoLora } from "@/lib/videos/stack";
import type { StackLora } from "@/lib/pictures/stack";
import type { PersonRow } from "@/types";

export const INSTALL_KIND = "lora_install";
export const INSTALL_TITLE = "Downloading a style";
export const ISSUE_SOURCE = "styles";

export const LICENCE_STEP_LINE = "Read the licence and confirm it first, then install the style.";
export const SHARED_SCREEN_LINE = "Install styles on your own screen.";
export const NOT_LTX_LINE = (label: string | null, media: Media = "video"): string => `Made for ${label ?? "another base"}. This household's ${media === "picture" ? "pictures" : "videos"} use ${supportedFamilyWords(media)}.`;
export const BASE_UNSTATED_LINE = "This style does not say which LTX 2 version it is for. Ask its maker, or pick the version yourself.";
export const TOO_BIG_LINE = "File is over 4 GB. Home can't use a style that large.";
export const NO_FILE_LINE = "No safe style file was found there. Home only installs .safetensors files.";
export const GATED_LINE = "Asks you to accept terms on Hugging Face first. Accept them on the site, save a Hugging Face token in settings, then try again.";
export const LOWER_UNKNOWN_LINE = "Unlock adult items first to choose All ages for this style.";
export const LOWER_ADULT_LINE = "The source says this style is for adults. Confirm your passcode again to choose All ages.";
export const CIVITAI_OFF_LINE = "Civitai is off. An owner or admin can turn it on in settings.";
export const DUPLICATE_LOCKED_LINE = "You already have this style.";
export const duplicateLine = (name: string): string => `You already have this as ${name}.`;
export const CHANGED_FILE_LINE = "The source changed this file since you installed it. Install it as a separate style if you want the new one.";

export interface InstallBody {
  source: LoraSite; remote_id?: string; version_id?: string | null; url?: string; file?: string | null;
  name?: string; kind?: "style" | "character"; audience: "all-ages" | "adult-only"; licence_confirmed: boolean; base_model?: AnyBaseId; media?: Media;
  confirm_ticket?: string; as_separate?: boolean;
}
export interface InstallActor { admin: PersonRow; sessionKey: string | null; proof: AdultProof }
export type InstallResult =
  | { ok: true; job: string }
  | { ok: false; status: 403 | 404 | 409 | 422 | 429 | 502 | 503; error: string; code: string; existing_id?: string };

/** What finishing needs, held encrypted in the job row. Holds no token. */
interface Ctx {
  site: LoraSite; remote_id: string; version_id: string | null; page_url: string; name: string; kind: "style" | "character"; audience: "all-ages" | "adult-only"; media?: Media;
  adult_check: AdultCheck; licence_id: string | null; commercial_use: "yes" | "no" | "unknown"; trigger_words: string[]; added_by: string;
  file_url: string; sha256: string | null; base_model: AnyBaseId; licence_text: string;
}
const sealCtx = (ctx: Ctx): string => encryptSecret(JSON.stringify(ctx));
function openCtx(provenance: string): { ctx: Ctx; stackJobId: string } | null {
  try {
    const p = JSON.parse(provenance) as { ctx?: string; stackJobId?: string };
    return p.ctx && p.stackJobId ? { ctx: JSON.parse(decryptSecret(p.ctx)) as Ctx, stackJobId: p.stackJobId } : null;
  } catch { return null; }
}

const fail = (status: Extract<InstallResult, { ok: false }>["status"], code: string, error: string, extra: { existing_id?: string } = {}): InstallResult => ({ ok: false, status, code, error, ...extra });

/** The confirm-item a ticket must be bound to (`POST /api/adult-lock/confirm { action: "unmark", item }`): the hit's own key, shortened. */
export const confirmItemOf = (hit: Pick<Hit, "site" | "remote_id" | "version_id">): string => `install:${Bun.hash(hitKey(hit)).toString(36)}`;

async function resolveHit(body: InstallBody): Promise<Hit> {
  if (body.source === "huggingface") {
    const link = body.url ? parseHfLink(body.url) : null;
    const repo = link?.repo ?? body.remote_id;
    if (!repo) throw new SourceError("not_found", "Paste a link to a Hugging Face style, or pick one from the results.", 404);
    const hit = await fetchHit("huggingface", repo);
    const want = link?.file ?? body.file ?? null;
    if (want && hit.file_name !== null && hit.version_id !== want) {
      // The link named a particular file; the detail call picked its own. Honour the link only if that file is a safetensors file of the repo.
      if (!want.toLowerCase().endsWith(".safetensors")) return { ...hit, file_url: null, version_id: null };
      return { ...hit, version_id: want, file_name: want.split("/").pop() ?? want, file_url: `https://huggingface.co/${repo}/resolve/main/${want.split("/").map(encodeURIComponent).join("/")}`, sha256: null, bytes: null };
    }
    return hit;
  }
  if (!body.remote_id) throw new SourceError("not_found", "Pick a style from the results.", 404);
  return fetchHit("civitai", body.remote_id, body.version_id ?? null);
}

export async function startLoraInstall(actor: InstallActor, body: InstallBody): Promise<InstallResult> {
  if (!actor.sessionKey) return fail(403, "shared_screen", SHARED_SCREEN_LINE);
  if (body.licence_confirmed !== true) return fail(422, "licence_not_confirmed", LICENCE_STEP_LINE);
  if (body.source === "civitai" && !civitaiEnabled()) return fail(403, "source_off", CIVITAI_OFF_LINE);
  let hit: Hit;
  try { hit = await resolveHit(body); } catch (error) {
    if (error instanceof SourceError) return fail(error.status === 400 ? 422 : error.status, error.code, error.message);
    throw error;
  }
  const records = listLoraRecords();
  const media = body.media ?? "video";
  // 15.4: duplicates first, in plain words, before any download.
  const have = installedAs(hit, records, media);
  const open = (l: Lora): { name: string; id: string } | null => { const r = readLora(actor.admin, l.id, "own_written", actor.proof); return r && r.state === "open" ? { name: r.lora.name, id: r.lora.id } : null; };
  if (have && !(have.by === "version" && have.lora.file.sha256 !== hit.sha256 && hit.sha256 !== null && body.as_separate === true)) {
    const seen = open(have.lora);
    if (have.by === "version" && hit.sha256 !== null && have.lora.file.sha256 !== hit.sha256) return fail(409, "changed_file", CHANGED_FILE_LINE, seen ? { existing_id: seen.id } : {});
    return fail(409, "duplicate", seen ? duplicateLine(seen.name) : DUPLICATE_LOCKED_LINE, seen ? { existing_id: seen.id } : {});
  }
  // The version comes from the source; only when the source names none does the admin's own pick count (checked here, not trusted from the client). Never guessed.
  const allowedBases = installableBaseIds(media);
  const picked = body.base_model && (allowedBases as readonly string[]).includes(body.base_model) ? body.base_model : null;
  const sourceNamesBase = hit.base_model !== "unknown";
  const base = sourceNamesBase
    ? (mediaOfBase(hit.base_model) === media ? hit.base_model : "unknown")
    : picked ?? "unknown";
  if (base === "unknown" && hit.base_unstated) return fail(422, "base_unstated", BASE_UNSTATED_LINE);
  if (base === "unknown" || !isSupportedBase(base, media)) return fail(422, "not_ltx", NOT_LTX_LINE(hit.base_label, media));
  if (!hit.file_url) return fail(422, "no_file", NO_FILE_LINE);
  if (hit.bytes !== null && hit.bytes > MAX_INSTALL_BYTES) return fail(422, "too_large", TOO_BIG_LINE);
  const token = tokenFor(hit.site);
  if (hit.gated && !token) return fail(422, "gated", GATED_LINE);
  // The audience: a source can only raise. Lowering needs the admin's explicit choice, and from `adult` a fresh passcode ticket.
  if (body.audience === "all-ages") {
    if (hit.adult_check.state === "unknown" && !unlockedFor(actor.admin, actor.proof)) return fail(403, "unlock_needed", LOWER_UNKNOWN_LINE);
    if (hit.adult_check.state === "adult" && !consumeTicket(body.confirm_ticket, actor.admin.id, actor.sessionKey, confirmItemOf(hit))) return fail(403, "ticket_needed", LOWER_ADULT_LINE);
  }
  const ctx: Ctx = {
    site: hit.site, remote_id: hit.remote_id, version_id: hit.version_id, page_url: hit.page_url, name: (body.name?.trim() || hit.title).slice(0, 80), kind: body.kind ?? hit.kind ?? "style",
    audience: body.audience, adult_check: hit.adult_check, licence_id: hit.licence_id?.slice(0, 80) ?? null, commercial_use: hit.commercial_use, trigger_words: cleanTriggerWords(hit.trigger_words),
    added_by: actor.admin.id, file_url: hit.file_url, sha256: hit.sha256, base_model: base, licence_text: hit.licence_id ?? "Not stated by the source", media,
  };
  return submit(ctx);
}

async function submit(ctx: Ctx): Promise<InstallResult> {
  const token = tokenFor(ctx.site);
  const stackBody: StackLoraInstallBody = {
    source: ctx.site, url: ctx.file_url, name: ctx.name, licence: ctx.licence_text, licence_acknowledged: true, audience: ctx.audience === "all-ages" ? "all-ages" : "adult",
    trigger_words: ctx.trigger_words, added_by: ctx.added_by, base_model: ctx.base_model, source_url: ctx.page_url,
    ...(ctx.sha256 ? { sha256_expected: ctx.sha256 } : {}), ...(token ? { token } : {}),
  };
  let jobId: string;
  try { jobId = (await installStackLora(ctx.media ?? "video", stackBody)).job; } catch (error) {
    if (error instanceof StackInstallRefused) {
      const status = error.status === 409 ? 409 : error.status === 503 ? 503 : error.status === 422 || error.status === 413 ? 422 : 502;
      const seen = error.existingId ? readLoraById(error.existingId) : null;
      return fail(status, error.code, error.code === "duplicate_lora" ? DUPLICATE_LOCKED_LINE : error.message, seen ? { existing_id: seen } : {});
    }
    if (error instanceof StackVideoError) return fail(503, error.code, error.message);
    throw error;
  }
  createJob({ id: `lora-install:${jobId}`, kind: INSTALL_KIND, startedBy: ctx.added_by, forPerson: null, title: INSTALL_TITLE, state: "running", progress: { status: "Downloading a style" }, errorKind: null, provenance: { producer: "stack", stackJobId: jobId, ctx: sealCtx(ctx) } });
  return { ok: true, job: jobId };
}

/** The id only when a live record has it (never a name; the route decides what a locked one may say). */
const readLoraById = (id: string): string | null => (getLoraRecord(id)?.removed_at === null ? id : null);

// ---- reconcile ----------------------------------------------------------------------------------------------------------------------------------

const finishing = new Set<string>();

function stackLoraOf(result: unknown): StackVideoLora | null {
  const lora = (result as { lora?: StackVideoLora } | null)?.lora;
  return lora && typeof lora.id === "string" ? lora : null;
}

/** Writes the `Lora` record for a finished install: admin-only availability, the audience the admin chose (never lower than the Stack's own class), `adult_check` as read. */
export async function finishInstall(ctx: Ctx, stackLora: StackVideoLora): Promise<Lora> {
  const media = ctx.media ?? "video";
  if (media === "picture") await adoptPictureLoras([stackLora as unknown as StackLora], ctx.added_by);
  else await syncLoras(true).catch(() => undefined);
  const now = new Date().toISOString();
  const have = getLoraRecord(stackLora.id) ?? recordFromStack(stackLora, null, ctx.added_by, now, media);
  if (!have) throw new Error("The style downloaded but could not be added to the library.");
  const adult = ctx.audience === "adult-only" || stackLora.classification !== "all-ages";
  const next: Lora = {
    ...have, media, ...(media === "picture" ? { base_model: "unknown" as const, compatible_with: [] } : {}),
    name: ctx.name, kind: ctx.kind, source: { site: ctx.site, url: ctx.page_url.slice(0, 2048), remote_id: ctx.remote_id, version_id: ctx.version_id, token_ref: null },
    trigger_words: ctx.trigger_words.length ? ctx.trigger_words : have.trigger_words, adult_check: ctx.adult_check,
    audience: adult ? "adult-only" : "all-ages", audience_set_by: adult ? null : ctx.added_by, audience_set_at: adult ? null : now,
    availability: { who: "admins", people: [] }, added_by: ctx.added_by, licence: { ...have.licence, id: ctx.licence_id, commercial_use: ctx.commercial_use, acknowledged_by: ctx.added_by, acknowledged_at: now },
    provenance: { origin: "install", job_id: null },
  };
  return saveLora(next, ctx.added_by);
}

function plainReason(reason: string | null): string {
  const text = (reason ?? "").replace(/^[a-z_]+:\s*/, "").trim();
  return text || "The download stopped. Try again.";
}

/** Brings every running install up to date from the Stack's job list. Idempotent; called by the install status route and the scheduler tick. */
export async function reconcileLoraInstalls(): Promise<number> {
  registerLoraInstallFixes();
  const rows = db.select().from(jobs).where(and(eq(jobs.kind, INSTALL_KIND), inArray(jobs.state, ["queued", "running"]))).all();
  let changed = 0;
  for (const row of rows) {
    const held = openCtx(row.provenance);
    if (!held || finishing.has(row.id)) continue;
    let job;
    try { job = await getStackInstallJob(held.stackJobId); } catch { continue; }
    if (job === null) { updateJob(row.id, { state: "failed", errorKind: "lost" }); await raise(held.stackJobId, "The download was lost when the computer restarted. Try again; it picks up where it left off."); changed++; continue; }
    if (job.state === "done") {
      finishing.add(row.id);
      try {
        const stackLora = stackLoraOf(job.result);
        if (!stackLora) throw new Error("no record");
        await finishInstall(held.ctx, stackLora);
        updateJob(row.id, { state: "done", progress: { status: "Done", percent: 100 }, errorKind: null });
        resolveIssue(ISSUE_SOURCE, `install.${held.stackJobId}`, { suppressNotification: true });
      } catch {
        updateJob(row.id, { state: "failed", errorKind: "record" });
        await raise(held.stackJobId, "The style downloaded but could not be added to the library. Try again.");
      } finally { finishing.delete(row.id); }
      changed++;
    } else if (job.state === "failed" || job.state === "cancelled") {
      const code = /^([a-z_]+):/.exec(job.reason ?? "")?.[1] ?? "failed";
      updateJob(row.id, { state: job.state, errorKind: code });
      await raise(held.stackJobId, plainReason(job.reason));
      changed++;
    } else {
      updateJob(row.id, { state: job.state === "queued" ? "queued" : "running", progress: { percent: job.percent ?? undefined, completedBytes: job.completedBytes ?? undefined, totalBytes: job.totalBytes ?? undefined, status: "Downloading a style" } });
    }
  }
  return changed;
}

async function raise(stackJobId: string, detail: string): Promise<void> {
  await raiseIssue({ source: ISSUE_SOURCE, key: `install.${stackJobId}`, severity: "warning", title: "A style did not download", detail, fix: { label: "Try again", action: `styles.install.retry:${stackJobId}` }, learnMore: "/settings/media" });
  registerLoraInstallFixes();
}

/** Try again: start the same install anew (the Stack resumes its `.part`), with the token as saved now. Registered at boot and after each failure. */
export function registerLoraInstallFixes(): void {
  for (const row of db.select().from(jobs).where(and(eq(jobs.kind, INSTALL_KIND), inArray(jobs.state, ["failed", "cancelled"]))).all()) {
    const held = openCtx(row.provenance);
    if (!held) continue;
    registerFixHandler(`styles.install.retry:${held.stackJobId}`, async () => {
      const again = await submit(held.ctx);
      if (!again.ok) throw new Error(again.error);
      db.delete(jobs).where(eq(jobs.id, row.id)).run();
    });
  }
}
