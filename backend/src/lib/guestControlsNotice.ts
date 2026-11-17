import { and, count, isNull, eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { trigger } from "@/lib/notifications";

export async function noticeGuestsWithoutControls(): Promise<number> {
  const row = db.select({ value: count() }).from(people)
    .where(and(eq(people.role, "guest"), isNull(people.deletedAt), isNull(people.controls))).get();
  const value = row?.value ?? 0;
  if (value > 0) {
    await trigger("people.guests_without_controls", { count: String(value) }, { repeatKey: "mode-guest-01" });
  }
  return value;
}
