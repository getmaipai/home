import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Transcript } from "@maipai/spec/gen/ts/transcript.js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { captionTracks, mediaItems, mediaSources, people, transcriptRevisions, transcripts } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { createCaptionTrack, listCaptionTracks, refreshCaptionTrack } from "@/lib/transcripts/captions";
import { buildCues, type Cue } from "@/lib/transcripts/cues";
import { applyFindReplace, previewFindReplace } from "@/lib/transcripts/findReplace";
import { importTranscript } from "@/lib/transcripts/import";
import { parseTranscriptDocument } from "@/lib/transcripts/parse";
import { __resetAutosavesForTests, applyOps, restoreRevision, undo } from "@/lib/transcripts/revisions";
import { createTranscript, getTranscript, revisionsForTranscript } from "@/lib/transcripts/store";
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

function made(texts: string[]) {
  return createTranscript(actor, {
    itemId: "media-transcript",
    language: "en",
    segments: texts.map((text, index) => ({ id: `seg-${index + 1}`, start: index * 2, end: index * 2 + 2, text })),
    provenance: { engine: "import", model_id: "fixture", source_kind: "imported" },
  });
}

describe("caption tracks needing a refresh", () => {
  test("a track is fresh when made, stale after an edit, fresh again after a refresh", () => {
    const created = made(["Sage speaks", "Nova answers"]);
    const track = createCaptionTrack(actor, created.id);
    expect(track).toMatchObject({ language: "en", based_on_revision: 1, needs_refreshing: false });

    applyOps(actor, created.id, actor.id, [{ kind: "edit_text", segment_id: "seg-1", text: "Sage speaks up" }]);
    expect(listCaptionTracks(actor, created.id)[0]).toMatchObject({ based_on_revision: 1, needs_refreshing: true });

    const refreshed = refreshCaptionTrack(actor, created.id, track.id);
    expect(refreshed).toMatchObject({ based_on_revision: 2, needs_refreshing: false });
    const stored = db.select().from(captionTracks).where(eq(captionTracks.id, track.id)).get()!;
    expect((JSON.parse(stored.cues) as Cue[])[0]?.text).toBe("Sage speaks up");
  });

  test("refresh keeps hand-edited cues and rebuilds the rest", () => {
    const created = made(["Sage speaks", "Nova answers"]);
    const track = createCaptionTrack(actor, created.id);
    const stored = db.select().from(captionTracks).where(eq(captionTracks.id, track.id)).get()!;
    const edited = (JSON.parse(stored.cues) as Cue[]).map((cue) =>
      cue.segment_id === "seg-1" ? { ...cue, text: "Sage (whispers)", text_overridden: true } : cue);
    db.update(captionTracks).set({ cues: JSON.stringify(edited) }).where(eq(captionTracks.id, track.id)).run();

    applyOps(actor, created.id, actor.id, [
      { kind: "edit_text", segment_id: "seg-1", text: "Sage speaks up" },
      { kind: "edit_text", segment_id: "seg-2", text: "Nova answers back" },
    ]);
    refreshCaptionTrack(actor, created.id, track.id);
    const cues = JSON.parse(db.select().from(captionTracks).where(eq(captionTracks.id, track.id)).get()!.cues) as Cue[];
    expect(cues.map((cue) => cue.text)).toEqual(["Sage (whispers)", "Nova answers back"]);
    expect(cues[0]?.text_overridden).toBe(true);
  });

  test("a track of another transcript is not found", () => {
    const created = made(["Sage speaks"]);
    expect(() => refreshCaptionTrack(actor, created.id, "no-such-track")).toThrow("caption track was not found");
  });
});

describe("find and replace", () => {
  const options = { find: "sage", replace: "Marlow" };

  test("preview lists matching lines and counts, and changes nothing", () => {
    const created = made(["Sage and sage", "Nova", "Sagebrush"]);
    const preview = previewFindReplace(actor, created.id, options);
    expect(preview).toMatchObject({ total_lines: 2, total_matches: 3, more: false });
    expect(preview.matches[0]).toMatchObject({ segment_id: "seg-1", start: 0, before: "Sage and sage", after: "Marlow and Marlow" });
    expect(getTranscript(actor, created.id).current_revision).toBe(1);
  });

  test("case and whole word rules", () => {
    const created = made(["Sage and sage", "Sagebrush", "sage, sage."]);
    // Case-sensitive 'sage' skips the capitalized Sage and finds the three lowercase ones.
    expect(previewFindReplace(actor, created.id, { ...options, match_case: true }).total_matches).toBe(3);
    expect(previewFindReplace(actor, created.id, { ...options, whole_word: true }).total_matches).toBe(4);
    expect(previewFindReplace(actor, created.id, { ...options, whole_word: true, match_case: true }).total_matches).toBe(3);
  });

  test("the find text is literal, not a pattern, and $ in the replacement is plain text", () => {
    const created = made(["a.b a-b", "cost (1)"]);
    expect(previewFindReplace(actor, created.id, { find: "a.b", replace: "$&" }).matches[0]?.after).toBe("$& a-b");
    expect(previewFindReplace(actor, created.id, { find: "(1)", replace: "2" }).total_matches).toBe(1);
  });

  test("apply makes one revision, never moves times, and undo restores everything", () => {
    const created = made(["Sage one", "Sage two", "Nova"]);
    const outcome = applyFindReplace(actor, created.id, options);
    expect(outcome).toEqual({ replaced_lines: 2, replaced_matches: 2 });
    const after = getTranscript(actor, created.id);
    expect(after.current_revision).toBe(2);
    expect(after.segments.map((segment) => segment.text)).toEqual(["Marlow one", "Marlow two", "Nova"]);
    expect(after.segments.map((segment) => [segment.start, segment.end])).toEqual([[0, 2], [2, 4], [4, 6]]);
    expect(revisionsForTranscript(actor, created.id).at(-1)?.reason).toBe("find and replace");

    undo(actor, created.id, actor.id);
    expect(getTranscript(actor, created.id).segments.map((segment) => segment.text)).toEqual(["Sage one", "Sage two", "Nova"]);
  });

  test("segment_ids limits the change to the listed lines", () => {
    const created = made(["Sage one", "Sage two"]);
    const outcome = applyFindReplace(actor, created.id, { ...options, segment_ids: ["seg-2"] });
    expect(outcome.replaced_lines).toBe(1);
    expect(getTranscript(actor, created.id).segments.map((segment) => segment.text)).toEqual(["Sage one", "Marlow two"]);
  });

  test("nothing to replace adds no revision; an empty find is refused with a plain message", () => {
    const created = made(["Nova"]);
    expect(applyFindReplace(actor, created.id, options)).toEqual({ replaced_lines: 0, replaced_matches: 0 });
    expect(getTranscript(actor, created.id).current_revision).toBe(1);
    expect(() => previewFindReplace(actor, created.id, { find: "", replace: "x" })).toThrow("Type the text to find");
    expect(() => applyFindReplace(actor, created.id, { find: "", replace: "x" })).toThrow("Type the text to find");
  });

  test("preview caps at 500 lines and says there are more", () => {
    const created = made(Array.from({ length: 503 }, () => "Sage"));
    const preview = previewFindReplace(actor, created.id, options);
    expect(preview.matches).toHaveLength(500);
    expect(preview).toMatchObject({ total_lines: 503, more: true });
  });
});
