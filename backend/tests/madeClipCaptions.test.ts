import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { attachments, captionTracks, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { __setTranscriptStackClientForTests } from "@/lib/transcripts/stack";
import { captionMadeClip } from "@/lib/transcripts/madeClipCaptions";
import type { Creation } from "@/lib/creations/store";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

const now = new Date().toISOString();
const actor = { id: "person-madeclip01", displayName: "Sage", role: "adult", avatarSeed: "sage", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:fixture" } as PersonRow;
const creation = { file_ids: ["file-madeclip0001"], words: { written: 'The line is “Hello there”.' } } as Creation;

beforeEach(() => {
  resetDb();
  db.insert(people).values({ id: actor.id, displayName: "Sage", role: "adult", avatarSeed: "sage", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:fixture" }).run();
  db.insert(attachments).values({ id: "file-madeclip0001", ownerPersonId: actor.id, conversationId: null, turnId: null, mediaType: "video/mp4", size: 4, sha256: createHash("sha256").update("clip").digest("hex"), storagePath: "people/madeclip/clip.mp4", provenance: 'video-gen:{"audience":"all-ages"}', createdAt: now, hlc: nextHlc() }).run();
});
afterEach(() => { __setTranscriptStackClientForTests(null); resetDb(); });

describe("made clip captions", () => {
  test("stores script wording as a caption track", async () => {
    __setTranscriptStackClientForTests({ transcribeJob: async () => ({
      language: "en", engine: "fake-stack", model_id: "fake", segments: [{ id: "seg1", start: 0.1, end: 0.7, text: "hello there", words: [{ text: "hello", start: 0.1, end: 0.3 }, { text: "there", start: 0.4, end: 0.7 }] }],
    }) });
    const id = await captionMadeClip({ actor, creation, clipFilePath: "/unused/clip.mp4" });
    if (!id) throw new Error("expected a caption track id");
    const row = db.select().from(captionTracks).all()[0];
    expect(row?.id).toBe(id);
    expect(JSON.parse(row!.cues).map((cue: { text: string }) => cue.text).join(" ")).toBe("Hello there");
  });

  test("skips transcription without quotes and returns null on source failure", async () => {
    let calls = 0;
    __setTranscriptStackClientForTests({ transcribeJob: async () => { calls++; throw new Error("offline"); } });
    expect(await captionMadeClip({ actor, creation: { file_ids: creation.file_ids, words: { written: "No dialogue here" } } as Creation, clipFilePath: "" })).toBeNull();
    expect(calls).toBe(0);
    expect(await captionMadeClip({ actor, creation, clipFilePath: "" })).toBeNull();
    expect(calls).toBe(1);
  });
});
