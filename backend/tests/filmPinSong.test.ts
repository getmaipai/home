// FILM-KEEP-01: the film's song is pinned as a kept file so the library reclaim (which reads only "conversation" files) cannot take it once the hidden chat is gone.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { pinFilmSong } from "@/lib/films/pinSong";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

describe("pinFilmSong", () => {
  beforeEach(() => resetDb());
  test("a conversation song becomes kept and named; another person's file is left alone", () => {
    const now = new Date().toISOString();
    for (const id of ["person-pinaaa", "person-pinbbb"]) db.insert(people).values({ id, displayName: id, role: "adult", avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
    const [a, b] = ["person-pinaaa", "person-pinbbb"].map((id) => db.select().from(people).all().find((row) => row.id === id)!) as PersonRow[];
    const mine = storeFile(a!, { conversationId: null, turnId: null, mediaType: "audio/wav", bytes: new Uint8Array([1, 2, 3]), provenance: "test", retention: "kept", deduplicate: false });
    const theirs = storeFile(b!, { conversationId: null, turnId: null, mediaType: "audio/wav", bytes: new Uint8Array([4, 5, 6]), provenance: "test", retention: "kept", deduplicate: false });
    if (!mine.ok || !theirs.ok) throw new Error("setup");
    for (const id of [mine.value.id, theirs.value.id]) db.update(attachments).set({ retention: "conversation" }).where(eq(attachments.id, id)).run();
    pinFilmSong(a!.id, mine.value.id, "Film song");
    pinFilmSong(a!.id, theirs.value.id, "Film song");
    const row = (id: string) => db.select({ retention: attachments.retention, name: attachments.name }).from(attachments).where(eq(attachments.id, id)).get()!;
    expect(row(mine.value.id)).toMatchObject({ retention: "kept", name: "Film song" });
    expect(row(theirs.value.id).retention).toBe("conversation");
  });
});
