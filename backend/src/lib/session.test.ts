import { beforeEach, expect, test } from "bun:test";
import { db } from "@/db";
import { people, sessions } from "@/db/schema";
import { pruneExpiredSessions } from "@/lib/session";
import { resetDb } from "../../tests/reset-db";

beforeEach(() => resetDb());

test("pruneExpiredSessions deletes expired rows and keeps live sessions", () => {
  const now = new Date().toISOString();
  db.insert(people).values({ id: "session-prune-person", displayName: "Session test", role: "owner", avatarSeed: "seed", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  const base = { personId: "session-prune-person", createdAt: now };
  db.insert(sessions).values([
    { ...base, id: "expired", tokenHash: "expired-token", expiresAt: "2000-01-01T00:00:00.000Z" },
    { ...base, id: "live", tokenHash: "live-token", expiresAt: "2999-01-01T00:00:00.000Z" },
  ]).run();

  expect(pruneExpiredSessions()).toBe(1);
  expect(db.select({ id: sessions.id }).from(sessions).all().map((row) => row.id)).toEqual(["live"]);
});
