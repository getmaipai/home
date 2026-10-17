// LIKENESS-01: the subject's own "Likeness use" log and the notification each use sends. One row each time another adult
// made a picture or video that looks like the person (spec LikenessUse): who, when and what kind. No prompt, picture or
// file is kept here. Only the subject reads the list. A person using their own likeness is not logged and notifies no one.
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { likenessUses, people } from "@/db/schema";
import { newLikenessUseId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { trigger } from "@/lib/notifications";
import type { LikenessMedium, LikenessWay } from "./decide";

export type UseSource = "chat" | "editor";

export interface LikenessUseInput {
  subjectPersonId: string;
  requesterPersonId: string;
  medium: LikenessMedium;
  way: LikenessWay;
  adultContent: boolean;
  source: UseSource;
}

export interface LikenessUseView { id: string; who: string; medium: LikenessMedium; way: LikenessWay; adult_content: boolean; used_at: string; line: string }

function kindWords(medium: LikenessMedium, way: LikenessWay): string {
  const thing = medium === "video" ? "a video" : "a picture";
  return way === "photo" ? `${thing} from a photo of you` : `${thing} with a saved style of you`;
}

/** Records one use and tells the subject. Never throws: a log or a notification that fails must not undo what was made (the guard has already run). */
export async function recordLikenessUse(input: LikenessUseInput): Promise<void> {
  if (input.subjectPersonId === input.requesterPersonId) return;
  try {
    const at = new Date().toISOString();
    db.insert(likenessUses).values({
      id: newLikenessUseId(), subjectPersonId: input.subjectPersonId, requesterPersonId: input.requesterPersonId, medium: input.medium, way: input.way,
      adultContent: input.adultContent, source: input.source, usedAt: at, createdAt: at, updatedAt: at, hlc: nextHlc(),
    }).run();
    const requester = db.select().from(people).where(eq(people.id, input.requesterPersonId)).get();
    await trigger("likeness.used", { who: requester ? (requester.nickname?.trim() || requester.displayName) : "Someone in your household", kind: kindWords(input.medium, input.way) }, { personId: input.subjectPersonId, subjectPersonId: input.requesterPersonId });
  } catch (error) {
    console.error("[likeness] could not record a use", error instanceof Error ? error.name : "error");
  }
}

/** The subject's own list, newest first. */
export function likenessUseLog(subjectPersonId: string, limit = 100): LikenessUseView[] {
  const rows = db.select().from(likenessUses).where(eq(likenessUses.subjectPersonId, subjectPersonId)).orderBy(desc(likenessUses.usedAt)).limit(limit).all();
  const names = new Map(db.select().from(people).all().map((person) => [person.id, person.nickname?.trim() || person.displayName] as const));
  return rows.map((row) => {
    const who = names.get(row.requesterPersonId) ?? "Someone in your household";
    const medium = row.medium as LikenessMedium;
    const way = row.way as LikenessWay;
    return { id: row.id, who, medium, way, adult_content: row.adultContent, used_at: row.usedAt, line: `${who} made ${kindWords(medium, way)}${row.adultContent ? ", including adult content" : ""}.` };
  });
}
