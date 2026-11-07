import { QuickTimer } from "@maipai/spec/gen/ts/quick-timer.js";
import type { QuickTimer as QT } from "@maipai/spec/gen/ts/quick-timer.js";
import { db } from "@/db";
import { quickTimers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { ownedRecordCrud } from "@/lib/ownedRecordCrud";
import type { PersonRow } from "@/types";

const timers = ownedRecordCrud({
  table: quickTimers, spec: QuickTimer, idPrefix: "qtimer", fields: ["name", "minutes"], trimmed: ["name"],
  invalid: "quick_timer_invalid", missing: "quick_timer_missing",
});

export function listQuickTimers(actor: PersonRow): QT[] {
  const initialized = db
    .select()
    .from(quickTimers)
    .where(eq(quickTimers.person, actor.id))
    .all()
    .some((row) => row.defaultsInitialized);

  if (!initialized) {
    const now = new Date().toISOString();
    const defaults: [[string, number], [string, number], [string, number], [string, number]] = [
      ["Tea steep", 4],
      ["A little break", 10],
      ["Focus session", 25],
      ["Deep work", 45],
    ];

    for (let i = 0; i < 4; i++) {
      const [name, minutes] = defaults[i]!;
      db.insert(quickTimers)
        .values({
          id: `qtimer-${randomSuffix(10)}`,
          person: actor.id,
          name,
          minutes,
          position: i,
          source: "hub",
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          hlc: nextHlc(),
          defaultsInitialized: i === 0,
        })
        .run();
    }
  }

  return timers.list(actor);
}

export const createQuickTimer = (actor: PersonRow, edit: { name?: string; minutes?: number; position?: number }) => timers.create(actor, edit);

export const updateQuickTimer = (actor: PersonRow, id: string, edit: Partial<Pick<QT, "name" | "minutes" | "position">>) => timers.update(actor, id, edit);

export const deleteQuickTimer = (actor: PersonRow, id: string) => timers.remove(actor, id);
