import { existsSync, statSync } from "node:fs";
import { householdCompanionFolder, listHouseholdCompanionIds, getHouseholdCompanion, deleteHouseholdCompanion } from "@/lib/householdCompanions";
import { readLook } from "@/lib/companionLook";

const WEEK = 7 * 24 * 60 * 60 * 1000;
export function sweepAbandonedDrafts(nowMs = Date.now()): number {
  let deleted = 0;
  for (const id of listHouseholdCompanionIds()) {
    const companion = getHouseholdCompanion(id)?.companion;
    if (companion?.status !== "draft" || readLook(id).versions.length) continue;
    const persona = companion as unknown as { tagline?: string; backstory?: string; interests?: unknown[]; examples?: unknown[] };
    if (persona.tagline || persona.backstory || persona.interests?.length || persona.examples?.length) continue;
    const folder = householdCompanionFolder(id); if (!folder || !existsSync(`${folder}/.name-only-draft`)) continue; // only drafts the three-screen flow started with a name; an older draft is never swept
    try { const info = statSync(`${folder}/manifest.json`), created = info.mtimeMs; if (nowMs - created > WEEK && deleteHouseholdCompanion(id)) deleted++; } catch { /* a concurrently removed draft is already gone */ }
  }
  console.warn(JSON.stringify({ component: "companions", event: "abandoned_drafts_swept", count: deleted }));
  return deleted;
}
