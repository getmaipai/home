import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { fileAudience } from "@/lib/access";
import { speakerAgeBand } from "@/lib/ageBand";
import { readAttachment } from "@/lib/attachments";
import { nextHlc } from "@/lib/hlc";
import { appendLogLine } from "@/lib/log";
import { checkImages, decideAgeCheck, MIN_ADULT_CONFIDENCE } from "@/lib/pictures/ageCheck";
import { tryConsume } from "@/lib/rateLimiter";
import type { PersonRow } from "@/types";

const missing = { ok: false as const, status: 404 as const, error: "That picture is not available for rechecking. Open one of your own adult-only pictures." };
export async function recheckFileAudience(actor: PersonRow, id: string) {
  const eligible = (person: PersonRow) => speakerAgeBand(person, new Date()) === "adult" && ["adult", "owner", "admin"].includes(person.role);
  const caller = db.select().from(people).where(eq(people.id, actor.id)).get();
  if (!caller || caller.deletedAt || !caller.enabled || !eligible(caller)) return missing;
  const row = db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt))).get();
  if (!row || row.ownerPersonId !== actor.id || !row.mediaType.startsWith("image/") || fileAudience(row.provenance) !== "adult-only") return missing;
  if (!tryConsume(`library:recheck:${actor.id}`, { capacity: 20, refillPerSecond: 20 / 3600 })) return { ok: false as const, status: 429 as const, error: "You have checked too many pictures. Wait an hour and try again." };
  let passed = false;
  let result = "unreadable";
  try {
    const file = readAttachment(caller, id);
    if (file.ok) {
      const checks = await checkImages([file.value.bytes], "picture");
      // Use the existing minor-viewer ceiling, independent of the prompt label. Low confidence is doubt for any label.
      passed = checks.length === 1 && checks.every(check => check.ok && check.verdict.confidence >= MIN_ADULT_CONFIDENCE) && decideAgeCheck(checks, false, "picture", "teen").action === "allow";
      result = passed ? "not-adult-only" : "adult-only-or-uncertain";
    }
  } catch { result = "check-error"; }
  // The person, pin, Trash state or provenance can change while the model runs. Never overwrite a newer decision.
  const current = db.select().from(people).where(eq(people.id, actor.id)).get();
  if (!current || current.deletedAt || !current.enabled || !eligible(current)) return missing;
  let changed = false;
  if (passed) {
    const colon = row.provenance.indexOf(":");
    const provenance = row.provenance.slice(0, colon + 1) + JSON.stringify({ ...JSON.parse(row.provenance.slice(colon + 1)), audience: "all-ages" });
    changed = db.update(attachments).set({ provenance, hlc: nextHlc() }).where(and(eq(attachments.id, id), eq(attachments.ownerPersonId, actor.id), eq(attachments.provenance, row.provenance), isNull(attachments.deletedAt))).returning({ id: attachments.id }).all().length === 1;
  }
  appendLogLine(JSON.stringify({ event: "library.recheck-audience", personId: actor.id, fileId: id, before: "adult-only", after: changed ? "all-ages" : "adult-only", result }));
  return changed
    ? { ok: true as const, value: { audience: "all-ages" as const } }
    : { ok: false as const, status: 400 as const, error: "That picture could not be confirmed as safe for everyone. It stays adult-only. Try again later or choose another picture to share." };
}
