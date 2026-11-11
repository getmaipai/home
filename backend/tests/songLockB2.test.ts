import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { attachments, mediaSources, musicJobs, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { redactLockedMusicOutcome, musicJobIdsByTurnRedacted } from "@/lib/music/lock";
import { musicForOutcomes } from "@/lib/composer";
import { outcomeOf } from "@/lib/turnContext";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

let sage: PersonRow;
beforeEach(async () => {
  resetDb(); __resetAdultLockForTests();
  const { TestClient } = await import("./client");
  const client = new TestClient();
  const setup = await (await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json() as { person: { id: string } };
  sage = db.select().from(people).where(eq(people.id, setup.person.id)).get() as PersonRow;
});

function addSong({ locked }: { locked: boolean }) {
  const id = locked ? "job-lock-b2" : "job-open-b2", turnId = `turn-${id}`, fileId = `file-${id}`;
  const now = new Date().toISOString();
  db.insert(mediaSources).values({ id: `src-${id}`, kind: "root", scope: "person", ownerPersonId: sage.id, label: "Music", createdAt: now, hlc: nextHlc(), provenance: "test" }).run();
  db.insert(attachments).values({ id: fileId, ownerPersonId: sage.id, conversationId: null, turnId: null, mediaType: "audio/mpeg", size: 8, sha256: createHash("sha256").update(id).digest("hex"), storagePath: `people/${sage.id}/attachments/${fileId}`, provenance: locked ? `music-gen:{"audience":"adult-only","lock":"on","job":"${id}"}` : `music-gen:{"audience":"all-ages","job":"${id}"}`, createdAt: now, hlc: nextHlc() }).run();
  db.insert(musicJobs).values({ id, personId: sage.id, conversationId: "conv-b2", turnId, task: "text2music", request: JSON.stringify({ title: "Hidden Request Title", lyrics: "hidden request lyrics" }), state: "done", progress: 1, fileId, createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
  return { id, turnId };
}

test("locked outcomes and history ids redact request text and job id; open songs retain both", () => {
  const locked = addSong({ locked: true }), open = addSong({ locked: false });
  const outcome = (id: string) => outcomeOf({ callId: id, packageId: "generate_music", status: "succeeded", via: "tool_call", args: { lyrics: "hidden request lyrics" }, durationMs: 0, result: { reply: { text: "Hidden Request Title and hidden request lyrics" }, data: { musicJobId: id }, actions: [] } });
  const redacted = redactLockedMusicOutcome(sage, outcome(locked.id));
  expect(JSON.stringify(redacted.result)).not.toContain(locked.id);
  expect(JSON.stringify(redacted)).not.toContain("hidden request");
  expect(musicForOutcomes([redacted])).toBeNull();
  const ids = musicJobIdsByTurnRedacted(sage, [locked.turnId, open.turnId]);
  expect(ids.get(locked.turnId)).toBeNull();
  expect(ids.get(open.turnId)).toBe(open.id);
  const ordinary = redactLockedMusicOutcome(sage, outcome(open.id));
  expect(JSON.stringify(ordinary)).toContain(open.id);
  expect(JSON.stringify(ordinary)).toContain("hidden request lyrics");
  expect(musicForOutcomes([ordinary])).toEqual({ id: open.id });
});
