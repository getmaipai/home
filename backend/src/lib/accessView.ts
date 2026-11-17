/**
 * UNSEEN-01 (RULES.md C10, S6a): what an owner or admin sees of one person's content access: the role, the level each kind of content
 * is held to, which kinds an override (the person's own row or the household's) set, and which kinds show unrated items. A derived
 * shape only (condition D): never the pass's version or access set, never a person id, never an item.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { audienceBand } from "@/lib/audience";
import { resolveLayeredScalar } from "@/lib/layeredScalar";
import { getRegistryKey } from "@/lib/settingsRegistry";
import { passFor, type ContentKind } from "@/lib/filter/pass";
import { CONTENT_CEILING_KEY, CONTENT_KINDS, CONTENT_UNRATED_KEY } from "@/settings/accessKeys";

const LEVEL_NAMES = ["G", "PG", "PG-13", "R", "X"] as const;
export type AccessLevel = (typeof LEVEL_NAMES)[number];

export interface PersonAccessView {
  role: string;
  ceiling: Record<ContentKind, AccessLevel>;
  /** One entry per content level or unrated setting the person's own row or the household's row set (`ceiling`, `ceiling.web`, `unrated.news`). */
  overrides: { key: string; scope: "person" | "household" }[];
  unrated: ContentKind[];
}

export function personAccessView(personId: string): PersonAccessView | null {
  const row = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).get();
  if (!row) return null;
  const band = audienceBand(row);
  const pass = passFor(personId);
  const ceiling = {} as Record<ContentKind, AccessLevel>;
  const overrides: PersonAccessView["overrides"] = [];
  const noteOverride = (full: string, short: string) => {
    const def = getRegistryKey(full);
    if (!def) return;
    const layer = resolveLayeredScalar(def, personId, band).layer;
    if (layer === "person" || layer === "household") overrides.push({ key: short, scope: layer });
  };
  noteOverride(CONTENT_CEILING_KEY, "ceiling");
  noteOverride(CONTENT_UNRATED_KEY, "unrated");
  for (const kind of CONTENT_KINDS) {
    ceiling[kind] = LEVEL_NAMES[pass.ceiling[kind]];
    noteOverride(`${CONTENT_CEILING_KEY}.${kind}`, `ceiling.${kind}`);
    noteOverride(`${CONTENT_UNRATED_KEY}.${kind}`, `unrated.${kind}`);
  }
  return { role: row.role, ceiling, overrides, unrated: CONTENT_KINDS.filter((kind) => pass.unrated.has(kind)) };
}
