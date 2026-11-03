// LIKENESS-01 and docs/design/RULES.md rule 0 ("Family: anyone in the household may make pictures, videos and songs with or of any
// household member, as a household option that is on by default"). `generation.household_likeness` is that option. Off, a person
// may not name another household member in a picture, a video or a song request. On (the default) nothing here refuses anything:
// an adult is never held to a likeness rule, and there is no consent proof or prompt (docs/design/adult-content-model-decides-2026-10-26.md).
// VIDEO-SETTINGS-04 added this reader; the key had none before.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { getHouseholdSettingValue } from "@/lib/settings";

export const HOUSEHOLD_LIKENESS_KEY = "generation.household_likeness";

export const LIKENESS_OFF_LINE = "Making things with or of another person in this home is switched off. An admin can switch it on in Settings, Pictures, videos and music.";

/** `generation.household_likeness`: on unless an admin turned it off. A read failure reads as on, the default (never a new restriction). */
export function householdLikenessAllowed(): boolean {
  try {
    return getHouseholdSettingValue(HOUSEHOLD_LIKENESS_KEY) !== false;
  } catch {
    return true;
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The names (display name, nickname) of the household members other than the speaker that the text names as whole words. */
export function otherMembersNamed(text: string, actorId: string): string[] {
  const found: string[] = [];
  const rows = db.select({ id: people.id, displayName: people.displayName, nickname: people.nickname, role: people.role })
    .from(people).where(and(isNull(people.deletedAt), eq(people.enabled, true))).all();
  for (const row of rows) {
    if (row.id === actorId || row.role === "guest") continue;
    for (const name of [row.displayName, row.nickname]) {
      const trimmed = (name ?? "").trim();
      if (trimmed.length < 2) continue;
      if (new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}])`, "iu").test(text)) { found.push(trimmed); break; }
    }
  }
  return found;
}

/** The plain line to show when the household option is off and `text` names another household member, else null. */
export function likenessRefusal(actor: { id: string }, text: string): string | null {
  if (householdLikenessAllowed()) return null;
  return otherMembersNamed(text, actor.id).length > 0 ? LIKENESS_OFF_LINE : null;
}

/** The refusal a picture, video or song tool call gets when the option is off and its words name another member (kind "likeness"), else null. */
export function likenessCallRefusal(actor: { id: string }, args: Record<string, unknown>): { kind: "likeness"; why: "household_likeness_off"; line: string } | null {
  const text = ["prompt", "style", "description", "lyrics", "title", "change"].map((name) => args[name]).filter((value): value is string => typeof value === "string").join(" ");
  const line = likenessRefusal(actor, text);
  return line ? { kind: "likeness", why: "household_likeness_off", line } : null;
}
