import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Transcript } from "@maipai/spec/gen/ts/transcript.js";
import { db } from "@/db";
import { mediaItems, mediaSources, people, transcriptRevisions, transcripts } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { buildCues } from "@/lib/transcripts/cues";
import { importTranscript } from "@/lib/transcripts/import";
import { parseTranscriptDocument } from "@/lib/transcripts/parse";
import { __resetAutosavesForTests, applyOps, restoreRevision, undo } from "@/lib/transcripts/revisions";
import { createTranscript, getTranscript } from "@/lib/transcripts/store";
import { writeJson, writeMarkdown, writeSrt, writeVtt } from "@/lib/transcripts/writers";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

const transcript: Transcript = {
  id: "transcript-roster",
  source: "media-roster",
  language: "en",
  current_revision: 1,
  segments: [
    { id: "seg-one", start: 3599.9996, end: 3602, text: "Sage hears Marlow speaking" },
    { id: "seg-two", start: 3602, end: 3603, text: "Nova answers", speaker: "speaker-nova" },
  ],
  speakers: [{ id: "speaker-nova", label: "Nova" }],
  vocabulary: [],
  provenance: { engine: "import", model_id: "fixture", source_kind: "imported" },
  clock: { created_at: "2026-11-06T00:00:00Z", updated_at: "2026-11-06T00:00:00Z", hlc: "1:0:abcdef" },
};
let actor: PersonRow;

beforeEach(() => {
  resetDb();
  const now = new Date().toISOString();
  db.insert(people).values({
    id: "person-sage0001",
    displayName: "Sage",
    role: "adult",
    avatarSeed: "sage",
    source: "local",
    createdAt: now,
    updatedAt: now,
    hlc: "1:0:test",
  }).run();
  actor = db.select().from(people).all().find((person) => person.id === "person-sage0001")!;
  db.insert(mediaSources).values({
    id: "msrc-transcript",
    kind: "root",
    scope: "household",
    ownerPersonId: actor.id,
    label: "Library",
    rootPath: "/tmp",
    rootKinds: '["video"]',
    visibleTo: '"household"',
    createdAt: now,
    hlc: nextHlc(),
    provenance: `person:${actor.id}`,
  }).run();
  db.insert(mediaItems).values({
    id: "media-transcript",
    kind: "video",
    title: "Sample clip",
    sourceId: "msrc-transcript",
    locRootId: "msrc-transcript",
    locPath: "sample.mp4",
    mediaType: "video/mp4",
    playable: "original",
    chapters: "[]",
    subtitles: "[]",
    locatorKind: "none",
    advisoryExplicit: false,
    advisorySource: "tag",
    bandOk: "child",
    addedAt: now,
    fingerprint: "test",
    hidden: false,
    createdAt: now,
    hlc: nextHlc(),
    provenance: "{}",
  }).run();
});

afterEach(() => {
  resetDb();
  __resetAutosavesForTests();
});

describe("transcript helpers", () => {
  test("writer goldens cover hours, millisecond rounding, separators and speakers", () => {
    const cues = buildCues(transcript.segments, { maxCharsPerLine: 42 });
    expect(writeSrt(cues)).toBe(
      "1\n01:00:00,000 --> 01:00:02,000\nSage hears Marlow speaking\n\n2\n01:00:02,000 --> 01:00:03,000\nNova answers\n",
    );
    expect(writeVtt(cues)).toBe(
      "WEBVTT\n\n01:00:00.000 --> 01:00:02.000\nSage hears Marlow speaking\n\n01:00:02.000 --> 01:00:03.000\nNova answers\n",
    );
    expect(writeMarkdown(transcript)).toContain("- 01:00:02.000 **Nova:** Nova answers");
    expect(JSON.parse(writeJson(transcript))).toEqual(transcript);
    const rollover = writeSrt([{
      id: "rollover",
      segment_id: "rollover",
      start: 3599.9996,
      end: 3600.0004,
      text: "Sage",
      text_overridden: false,
    }]);
    expect(rollover).toContain("01:00:00,000 --> 01:00:00,000");
  });

  test("cue builder splits at words, caps speed and keeps speaker boundaries", () => {
    const cues = buildCues([
      { id: "a", start: 0, end: 10, text: "one two three four five six seven eight nine ten", speaker: "speaker-nova" },
      { id: "b", start: 10, end: 13, text: "hello world", speaker: "speaker-sage" },
    ], { maxCharsPerLine: 10, maxLines: 1, readingSpeed: 2, maxDuration: 2 });
    expect(cues.length).toBeGreaterThan(2);
    expect(cues.every((cue) => !cue.text.startsWith(" ") && !cue.text.endsWith(" ") && !cue.text.includes("  "))).toBe(true);
    expect(cues.some((cue) => cue.text.includes("one") && cue.text.includes("two"))).toBe(false);
    expect(cues.find((cue) => cue.segment_id === "b")).toBeDefined();
    expect(cues.filter((cue) => cue.segment_id === "a")
      .every((cue) => cue.text.length / (cue.end - cue.start) <= 2.01)).toBe(true);
  });

  test("SRT and VTT parse; untimed text gets generation guidance", () => {
    const parsed = parseTranscriptDocument("1\n00:00:01,001 --> 00:00:02,002\nSage speaks\n", "srt");
    expect(parsed.segments[0]?.start).toBe(1.001);
    expect(() => importTranscript(actor, "media-transcript", "Sage speaks", "txt"))
      .toThrow("Generate a transcript from the audio or video instead.");
  });

  test("SRT and VTT export and import round trip within one millisecond", () => {
    for (const [format, raw] of [
      ["srt", writeSrt(buildCues(transcript.segments))],
      ["vtt", writeVtt(buildCues(transcript.segments))],
    ] as const) {
      const parsed = parseTranscriptDocument(raw, format);
      expect(parsed.segments.map(({ start, end, text }) => ({ start, end, text }))).toEqual(
        transcript.segments.map(({ start, end, text }) => ({
          start: Math.round(start * 1000) / 1000,
          end: Math.round(end * 1000) / 1000,
          text,
        })),
      );
    }
  });

  test("same-author autosaves coalesce and undo or restore append revisions", () => {
    const created = createTranscript(actor, {
      itemId: "media-transcript",
      language: "en",
      segments: [{ id: "s1", start: 0, end: 1, text: "Sage" }],
      provenance: transcript.provenance,
    });
    expect(() => applyOps(actor, created.id, actor.id, [
      { kind: "replace_text", segment_id: "missing", text: "x" },
    ])).toThrow("line was not found");

    applyOps(actor, created.id, actor.id, [{ kind: "replace_text", segment_id: "s1", text: "Marlow" }], "autosave", 100);
    applyOps(actor, created.id, actor.id, [{ kind: "replace_text", segment_id: "s1", text: "Nova" }], "autosave", 200);
    expect(db.select().from(transcriptRevisions).all()).toHaveLength(1);
    applyOps(actor, created.id, actor.id, [{ kind: "replace_text", segment_id: "s1", text: "Iris" }], "edit", 300);
    expect(db.select().from(transcriptRevisions).all()).toHaveLength(2);
    undo(actor, created.id, actor.id);
    expect(db.select().from(transcripts).get()?.currentRevision).toBe(3);
    restoreRevision(actor, created.id, 2, actor.id);
    expect(db.select().from(transcripts).get()?.currentRevision).toBe(4);
    expect(db.select().from(transcriptRevisions).all().map((revision) => revision.n)).toEqual([1, 2, 3, 4]);
    expect(getTranscript(actor, created.id).segments[0]?.text).toBe("Iris");
  });
  test("add_speaker and rename_speaker persist, and undo and restore bring speakers back", () => {
    const created = createTranscript(actor, {
      itemId: "media-transcript",
      language: "en",
      segments: [{ id: "s1", start: 0, end: 1, text: "Sage" }],
      provenance: transcript.provenance,
    });
    applyOps(actor, created.id, actor.id, [
      { kind: "add_speaker", speaker_id: "spk-a1", label: "Sage" },
      { kind: "set_speaker", segment_id: "s1", speaker: "spk-a1" },
    ]);
    expect(getTranscript(actor, created.id).speakers).toEqual([{ id: "spk-a1", label: "Sage" }]);
    expect(getTranscript(actor, created.id).segments[0]?.speaker).toBe("spk-a1");
    expect(() => applyOps(actor, created.id, actor.id, [{ kind: "add_speaker", speaker_id: "spk-a1", label: "Again" }])).toThrow("already exists");
    expect(() => applyOps(actor, created.id, actor.id, [{ kind: "rename_speaker", speaker_id: "nope", label: "X" }])).toThrow("not found");
    expect(() => applyOps(actor, created.id, actor.id, [{ kind: "add_speaker", speaker_id: "spk-b2", label: "  " }])).toThrow("Give the speaker a name");
    applyOps(actor, created.id, actor.id, [{ kind: "rename_speaker", speaker_id: "spk-a1", label: "Marlow" }]);
    expect(getTranscript(actor, created.id).speakers).toEqual([{ id: "spk-a1", label: "Marlow" }]);
    undo(actor, created.id, actor.id);
    expect(getTranscript(actor, created.id).speakers).toEqual([{ id: "spk-a1", label: "Sage" }]);
    restoreRevision(actor, created.id, 1, actor.id);
    expect(getTranscript(actor, created.id).speakers).toEqual([]);
    expect(getTranscript(actor, created.id).segments[0]?.speaker).toBeUndefined();
    restoreRevision(actor, created.id, 3, actor.id);
    expect(getTranscript(actor, created.id).speakers).toEqual([{ id: "spk-a1", label: "Marlow" }]);
  });
});
