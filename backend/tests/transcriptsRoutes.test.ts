import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@/db";
import { mediaItems, mediaSources, people, sessions } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { __resetBurnJobsForTests, __setBurnRunnerForTests } from "@/lib/transcripts/burnIn";
import { __setTranslationCompleterForTests } from "@/lib/transcripts/captionTranslate";
import { __setTranscriptStackClientForTests } from "@/lib/transcripts/stack";
import { transcriptRoutes } from "@/routes/transcripts";
import { resetDb } from "./reset-db";

const app = new OpenAPIHono();
app.route("/api", transcriptRoutes);
const now = new Date().toISOString();

function person(id: string, role: string): string {
  db.insert(people).values({
    id,
    displayName: id,
    role,
    avatarSeed: id,
    source: "local",
    createdAt: now,
    updatedAt: now,
    hlc: "1:0:test",
  }).run();
  const token = `token-${id}`;
  db.insert(sessions).values({
    id: `session-${id}`,
    personId: id,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: now,
  }).run();
  return token;
}

function item(ownerId: string, visibleTo: unknown = "household"): void {
  const sourceId = `msrc-${ownerId.slice(-8)}`;
  db.insert(mediaSources).values({
    id: sourceId,
    kind: "root",
    scope: "household",
    ownerPersonId: ownerId,
    label: "Library",
    rootPath: "/tmp",
    rootKinds: '["video"]',
    visibleTo: JSON.stringify(visibleTo),
    createdAt: now,
    hlc: nextHlc(),
    provenance: `person:${ownerId}`,
  }).run();
  db.insert(mediaItems).values({
    id: "media-caption01",
    kind: "video",
    title: "Sample clip",
    sourceId,
    locRootId: sourceId,
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
    fingerprint: "fixture",
    hidden: false,
    createdAt: now,
    hlc: nextHlc(),
    provenance: "{}",
  }).run();
}

async function req(path: string, token: string, method = "GET", body?: unknown): Promise<Response> {
  return app.request(`http://localhost/api${path}`, {
    method,
    headers: { cookie: `session=${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  resetDb();
  __setTranscriptStackClientForTests({
    transcribeJob: async () => ({
      language: "en",
      segments: [{ id: "seg-sage", start: 0, end: 1, text: "Sage speaks" }],
      engine: "stack",
      model_id: "parakeet",
    }),
  });
});

afterEach(() => {
  __setTranscriptStackClientForTests(null);
  resetDb();
});

describe("transcript routes", () => {
  test("generation, get, patch, history, restore and exports use the scripted Stack client", async () => {
    const token = person("person-sage0001", "adult");
    item("person-sage0001");

    expect((await req("/library/media-caption01/transcript", token)).status).toBe(404);
    const made = await req("/library/media-caption01/transcript", token, "POST", {});
    expect(made.status).toBe(201);
    const record = await made.json() as { id: string };
    const found = await req("/library/media-caption01/transcript", token);
    expect(found.status).toBe(200);
    expect((await found.json() as { id: string }).id).toBe(record.id);
    expect((await req(`/transcripts/${record.id}`, token)).status).toBe(200);
    expect((await req(`/transcripts/${record.id}`, token, "PATCH", {
      ops: [{ kind: "replace_text", segment_id: "seg-sage", text: "Sage speaks clearly" }],
    })).status).toBe(200);
    expect((await req(`/transcripts/${record.id}/revisions`, token)).status).toBe(200);
    expect((await req(`/transcripts/${record.id}/restore`, token, "POST", { revision: 1 })).status).toBe(200);

    for (const format of ["srt", "vtt", "txt", "md", "json"]) {
      const response = await req(`/transcripts/${record.id}/export?format=${format}`, token);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toBe("");
    }

    const withSpeaker = await req(`/transcripts/${record.id}`, token, "PATCH", {
      ops: [
        { kind: "add_speaker", speaker_id: "spk-route1", label: "Sage" },
        { kind: "set_speaker", segment_id: "seg-sage", speaker: "spk-route1" },
        { kind: "rename_speaker", speaker_id: "spk-route1", label: "Nova" },
      ],
    });
    expect(withSpeaker.status).toBe(200);
    expect((await withSpeaker.json() as { speakers: unknown }).speakers).toEqual([{ id: "spk-route1", label: "Nova" }]);
    expect((await req(`/transcripts/${record.id}`, token, "PATCH", { ops: [{ kind: "rename_speaker", speaker_id: "ghost", label: "X" }] })).status).toBe(400);

    const imported = await req("/library/media-caption01/transcript/import", token, "POST", {
      format: "srt",
      text: "1\n00:00:00,000 --> 00:00:01,000\nSage speaks",
    });
    expect(imported.status).toBe(201);
  });

  test("strangers get 404 and children get the podcast transcript refusal", async () => {
    const owner = person("person-sage0001", "adult");
    const stranger = person("person-riff0001", "adult");
    const child = person("person-sprout1", "child");
    item("person-sage0001", ["person-sage0001", "person-sprout1"]);

    const made = await req("/library/media-caption01/transcript/import", owner, "POST", {
      format: "srt",
      text: "1\n00:00:00,000 --> 00:00:01,000\nSage speaks",
    });
    expect(made.status).toBe(201);
    const { id } = await made.json() as { id: string };
    expect((await req(`/transcripts/${id}`, stranger)).status).toBe(404);
    expect((await req(`/transcripts/${id}`, child)).status).toBe(403);
  });
});

// CAPTION-01g: detect speakers and redo one range. The Stack is scripted; nothing reaches a real engine.
type JobInput = { item_id: string; diarize?: boolean; num_speakers?: number; from_s?: number; to_s?: number };
type Doc = {
  id: string;
  current_revision: number;
  segments: Array<{ id: string; start: number; end: number; text: string; speaker?: string }>;
  speakers: Array<{ id: string; label: string }>;
};

async function importedTranscript(token: string): Promise<Doc> {
  const made = await req("/library/media-caption01/transcript/import", token, "POST", {
    format: "srt",
    text: "1\n00:00:00,000 --> 00:00:04,000\nHello there\n\n2\n00:00:05,000 --> 00:00:09,000\nHi back\n\n3\n00:00:10,000 --> 00:00:14,000\nBye now",
  });
  expect(made.status).toBe(201);
  return await made.json() as Doc;
}

describe("detect speakers", () => {
  const jobs: JobInput[] = [];
  beforeEach(() => { jobs.length = 0; });

  function script(result: Record<string, unknown>) {
    __setTranscriptStackClientForTests({
      transcribeJob: async (input) => {
        jobs.push(input as JobInput);
        return { language: "en", segments: [], engine: "stack", model_id: "m", ...result } as never;
      },
    });
  }

  test("assigns speakers by time overlap, keeps edited text, and adds ONE revision that undo reverses", async () => {
    const token = person("person-sage0001", "adult");
    item("person-sage0001");
    const doc = await importedTranscript(token);
    const edited = await req(`/transcripts/${doc.id}`, token, "PATCH", {
      ops: [{ kind: "replace_text", segment_id: doc.segments[1]!.id, text: "Hi back, corrected" }],
    });
    expect(edited.status).toBe(200);
    const before = await (await req(`/transcripts/${doc.id}`, token)).json() as Doc;

    script({
      diarization: "done",
      speakers: [{ id: "spk-1", label: "Speaker 1" }, { id: "spk-2", label: "Speaker 2" }],
      // Stack lines are cut differently and carry different text: only the speaker may be used.
      segments: [
        { id: "s1", start: 0, end: 3, text: "different words", speaker: "spk-1" },
        { id: "s2", start: 3.5, end: 9.5, text: "other words", speaker: "spk-2" },
        { id: "s3", start: 10, end: 14, text: "more", speaker: "spk-1" },
      ],
    });
    const response = await req(`/transcripts/${doc.id}/detect-speakers`, token, "POST", { num_speakers: 2 });
    expect(response.status).toBe(200);
    const body = await response.json() as { transcript: Doc; diarization: string; note: string | null };
    expect(body.diarization).toBe("done");
    expect(jobs[0]).toMatchObject({ diarize: true, num_speakers: 2 });
    expect(body.transcript.segments.map((s) => s.speaker)).toEqual(["spk-1", "spk-2", "spk-1"]);
    expect(body.transcript.segments.map((s) => s.text)).toEqual(["Hello there", "Hi back, corrected", "Bye now"]);
    expect(body.transcript.speakers.map((s) => s.id)).toEqual(["spk-1", "spk-2"]);
    expect(body.transcript.current_revision).toBe(before.current_revision + 1);

    const revisions = await (await req(`/transcripts/${doc.id}/revisions`, token)).json() as Array<{ reason: string }>;
    expect(revisions.at(-1)!.reason).toBe("detect speakers");

    const undone = await (await req(`/transcripts/${doc.id}/undo`, token, "POST")).json() as Doc;
    expect(undone.segments.map((s) => s.speaker)).toEqual([undefined, undefined, undefined]);
    expect(undone.segments.map((s) => s.text)).toEqual(before.segments.map((s) => s.text));
  });

  test("keeps a name the person gave a speaker", async () => {
    const token = person("person-sage0001", "adult");
    item("person-sage0001");
    const doc = await importedTranscript(token);
    await req(`/transcripts/${doc.id}`, token, "PATCH", { ops: [{ kind: "add_speaker", speaker_id: "spk-1", label: "Nova" }] });
    script({
      diarization: "done",
      speakers: [{ id: "spk-1", label: "Speaker 1" }],
      segments: [{ id: "s1", start: 0, end: 14, text: "x", speaker: "spk-1" }],
    });
    const body = await (await req(`/transcripts/${doc.id}/detect-speakers`, token, "POST")).json() as { transcript: Doc };
    expect(body.transcript.speakers).toEqual([{ id: "spk-1", label: "Nova" }]);
  });

  test("unavailable leaves the transcript unchanged and returns the Stack's note", async () => {
    const token = person("person-sage0001", "adult");
    item("person-sage0001");
    const doc = await importedTranscript(token);
    script({ diarization: "unavailable", diarization_note: "Speaker detection needs the speaker models. Install them in Stack and try again." });
    const response = await req(`/transcripts/${doc.id}/detect-speakers`, token, "POST");
    expect(response.status).toBe(200);
    const body = await response.json() as { transcript: Doc; diarization: string; note: string };
    expect(body.diarization).toBe("unavailable");
    expect(body.note).toContain("speaker models");
    expect(body.transcript.current_revision).toBe(doc.current_revision);
    expect(body.transcript.segments.every((s) => s.speaker === undefined)).toBe(true);
  });

  test("a Stack failure is a plain 502, a bad count is 400, a child is refused", async () => {
    const token = person("person-sage0001", "adult");
    const child = person("person-sprout1", "child");
    item("person-sage0001", ["person-sage0001", "person-sprout1"]);
    const doc = await importedTranscript(token);
    __setTranscriptStackClientForTests({ transcribeJob: async () => { throw new Error("engine down"); } });
    const failed = await req(`/transcripts/${doc.id}/detect-speakers`, token, "POST");
    expect(failed.status).toBe(502);
    expect((await failed.json() as { error: string }).error).toContain("try again");
    expect((await req(`/transcripts/${doc.id}/detect-speakers`, token, "POST", { num_speakers: 99 })).status).toBe(400);
    expect((await req(`/transcripts/${doc.id}/detect-speakers`, child, "POST")).status).toBe(403);
  });
});

describe("regenerate range", () => {
  const jobs: unknown[] = [];
  beforeEach(() => { jobs.length = 0; });

  test("replaces only the lines in the range, on the original timeline, as one revision; corrections elsewhere stay", async () => {
    const token = person("person-sage0001", "adult");
    item("person-sage0001");
    const doc = await importedTranscript(token);
    await req(`/transcripts/${doc.id}`, token, "PATCH", { ops: [{ kind: "replace_text", segment_id: doc.segments[0]!.id, text: "Hello there, corrected" }] });
    const before = await (await req(`/transcripts/${doc.id}`, token)).json() as Doc;
    __setTranscriptStackClientForTests({
      transcribeJob: async (input) => {
        jobs.push(input);
        return { language: "en", engine: "stack", model_id: "m", segments: [
          { id: "r1", start: 5, end: 7, text: "Hi again" },
          { id: "r2", start: 7, end: 9.5, text: "friend" },
        ] };
      },
    });
    const response = await req(`/transcripts/${doc.id}/regenerate-range`, token, "POST", { start: 5, end: 9 });
    expect(response.status).toBe(200);
    expect(jobs[0]).toMatchObject({ from_s: 5, to_s: 9 });
    const after = await response.json() as Doc;
    expect(after.segments.map((s) => s.text)).toEqual(["Hello there, corrected", "Hi again", "friend", "Bye now"]);
    // times stay on the original timeline and are clamped to the range
    expect(after.segments.slice(1, 3).map((s) => [s.start, s.end])).toEqual([[5, 7], [7, 9]]);
    expect(new Set(after.segments.map((s) => s.id)).size).toBe(4);
    expect(after.current_revision).toBe(before.current_revision + 1);
    const revisions = await (await req(`/transcripts/${doc.id}/revisions`, token)).json() as Array<{ reason: string }>;
    expect(revisions.at(-1)!.reason).toBe("regenerate range");
    const undone = await (await req(`/transcripts/${doc.id}/undo`, token, "POST")).json() as Doc;
    expect(undone.segments.map((s) => s.text)).toEqual(before.segments.map((s) => s.text));
  });

  test("a redone line keeps the speaker of the line it replaced", async () => {
    const token = person("person-sage0001", "adult");
    item("person-sage0001");
    const doc = await importedTranscript(token);
    await req(`/transcripts/${doc.id}`, token, "PATCH", { ops: [
      { kind: "add_speaker", speaker_id: "spk-1", label: "Nova" },
      { kind: "set_speaker", segment_id: doc.segments[1]!.id, speaker: "spk-1" },
    ] });
    __setTranscriptStackClientForTests({ transcribeJob: async () => ({ language: "en", segments: [{ id: "r", start: 5, end: 9, text: "Hi" }] }) });
    const after = await (await req(`/transcripts/${doc.id}/regenerate-range`, token, "POST", { start: 5, end: 9 })).json() as Doc;
    expect(after.segments[1]).toMatchObject({ text: "Hi", speaker: "spk-1" });
  });

  test("validation: end before start, past the end, no speech, Stack failure", async () => {
    const token = person("person-sage0001", "adult");
    item("person-sage0001");
    const doc = await importedTranscript(token);
    const bad = await req(`/transcripts/${doc.id}/regenerate-range`, token, "POST", { start: 9, end: 5 });
    expect(bad.status).toBe(400);
    expect((await bad.json() as { error: string }).error).toContain("after the start");
    expect((await req(`/transcripts/${doc.id}/regenerate-range`, token, "POST", { start: 500, end: 600 })).status).toBe(400);
    expect(jobs.length).toBe(0);

    __setTranscriptStackClientForTests({ transcribeJob: async () => ({ language: "en", segments: [] }) });
    const silent = await req(`/transcripts/${doc.id}/regenerate-range`, token, "POST", { start: 5, end: 9 });
    expect(silent.status).toBe(409);
    const unchanged = await (await req(`/transcripts/${doc.id}`, token)).json() as Doc;
    expect(unchanged.current_revision).toBe(doc.current_revision);

    __setTranscriptStackClientForTests({ transcribeJob: async () => { throw new Error("engine down"); } });
    expect((await req(`/transcripts/${doc.id}/regenerate-range`, token, "POST", { start: 5, end: 9 })).status).toBe(502);
  });

  test("caption tracks go stale after an edit and refresh on request; find and replace previews then applies", async () => {
    const token = person("person-sage0001", "adult");
    item("person-sage0001");
    const record = await (await req("/library/media-caption01/transcript", token, "POST", {})).json() as { id: string };

    const created = await req(`/transcripts/${record.id}/caption-tracks`, token, "POST");
    expect(created.status).toBe(201);
    const track = await created.json() as { id: string; needs_refreshing: boolean };
    expect(track.needs_refreshing).toBe(false);

    await req(`/transcripts/${record.id}`, token, "PATCH", { ops: [{ kind: "edit_text", segment_id: "seg-sage", text: "Sage speaks clearly" }] });
    const listed = await (await req(`/transcripts/${record.id}/caption-tracks`, token)).json() as Array<{ needs_refreshing: boolean }>;
    expect(listed[0]?.needs_refreshing).toBe(true);
    const read = await (await req(`/transcripts/${record.id}`, token)).json() as { caption_tracks: Array<{ needs_refreshing: boolean }> };
    expect(read.caption_tracks[0]?.needs_refreshing).toBe(true);

    const refreshed = await req(`/transcripts/${record.id}/caption-tracks/${track.id}/refresh`, token, "POST");
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json() as { needs_refreshing: boolean }).needs_refreshing).toBe(false);
    expect((await req(`/transcripts/${record.id}/caption-tracks/nope/refresh`, token, "POST")).status).toBe(404);

    const preview = await req(`/transcripts/${record.id}/find-replace/preview`, token, "POST", { find: "clearly", replace: "loudly" });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ total_lines: 1, more: false, matches: [{ segment_id: "seg-sage", after: "Sage speaks loudly" }] });
    expect((await req(`/transcripts/${record.id}/find-replace/preview`, token, "POST", { find: "", replace: "x" })).status).toBe(400);
    expect((await req(`/transcripts/${record.id}/find-replace`, token, "POST", { find: "", replace: "x" })).status).toBe(400);

    const applied = await req(`/transcripts/${record.id}/find-replace`, token, "POST", { find: "clearly", replace: "loudly" });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({ replaced_lines: 1, transcript: { current_revision: 3 } });
    const undone = await (await req(`/transcripts/${record.id}/undo`, token, "POST")).json() as { segments: Array<{ text: string }> };
    expect(undone.segments[0]?.text).toBe("Sage speaks clearly");
  });

  test("a caption track translates into its own track; bad answers and held-back text store nothing", async () => {
    const token = person("person-sage0001", "adult");
    item("person-sage0001");
    const record = await (await req("/library/media-caption01/transcript", token, "POST", {})).json() as { id: string };
    const track = await (await req(`/transcripts/${record.id}/caption-tracks`, token, "POST")).json() as { id: string; cue_count: number };
    const path = `/transcripts/${record.id}/caption-tracks/${track.id}`;
    try {
      const langs = await (await req("/transcript-languages", token)).json() as Array<{ code: string }>;
      expect(langs.some((l) => l.code === "es")).toBe(true);

      __setTranslationCompleterForTests(async (messages) => {
        const lines = JSON.parse(messages[1]!.content as string) as string[];
        return { ok: true, text: JSON.stringify(lines.map((line) => `ES ${line}`)) };
      });
      const waitJob = async (jobId: string) => {
        for (let i = 0; i < 100; i += 1) {
          const state = await (await req(`/transcript-translations/${jobId}`, token)).json() as { state: string; progress: number; track?: { id: string; language: string; cue_count: number }; error?: string };
          if (state.state !== "running") return state;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error("translation did not finish");
      };
      const made = await req(`${path}/translate`, token, "POST", { language: "es" });
      expect(made.status).toBe(202);
      const finished = await waitJob((await made.json() as { id: string }).id);
      expect(finished.state).toBe("done");
      expect(finished.progress).toBe(1);
      const spanish = finished.track!;
      expect(spanish).toMatchObject({ language: "es", cue_count: track.cue_count });
      const srt = await (await req(`${path.replace("/caption-tracks/" + track.id, "")}/export?format=srt&track=${spanish.id}`, token)).text();
      expect(srt).toContain("ES ");
      expect((await req(`${path.replace("/caption-tracks/" + track.id, "")}/export?format=srt&track=nope`, token)).status).toBe(404);
      const refusedRefresh = await req(`/transcripts/${record.id}/caption-tracks/${spanish.id}/refresh`, token, "POST");
      expect(refusedRefresh.status).toBe(409);

      expect((await req(`${path}/translate`, token, "POST", { language: "xx" })).status).toBe(400);
      expect((await req(`${path}/translate`, token, "POST", { language: "en" })).status).toBe(400);
      expect((await req(`/transcripts/${record.id}/caption-tracks/nope/translate`, token, "POST", { language: "es" })).status).toBe(404);

      __setTranslationCompleterForTests(async () => ({ ok: true, text: "[\"only one\", \"two\", \"three\", \"four\", \"five\", \"six\", \"seven\", \"eight\", \"nine\", \"ten\", \"eleven\", \"twelve\", \"x\", \"y\", \"z\", \"a\", \"b\", \"c\", \"d\", \"e\", \"f\"]" }));
      const bad = await req(`${path}/translate`, token, "POST", { language: "fr" });
      expect(bad.status).toBe(202);
      const badDone = await waitJob((await bad.json() as { id: string }).id);
      expect(badDone.state).toBe("failed");
      expect(badDone.error).toContain("try again");
      expect((await req("/transcript-translations/nope", token)).status).toBe(404);
      const after = await (await req(`/transcripts/${record.id}/caption-tracks`, token)).json() as unknown[];
      expect(after.length).toBe(2);
    } finally { __setTranslationCompleterForTests(null); }
  });

  test("burn-in burns a video into a new file; a missing file or failed edit says what to do", async () => {
    const token = person("person-sage0001", "adult");
    item("person-sage0001");
    const record = await (await req("/library/media-caption01/transcript", token, "POST", {})).json() as { id: string };
    const track = await (await req(`/transcripts/${record.id}/caption-tracks`, token, "POST")).json() as { id: string };
    const start = () => req(`/transcripts/${record.id}/caption-tracks/${track.id}/burn-in`, token, "POST", { position: "top" });
    const waitDone = async (jobId: string) => {
      for (let i = 0; i < 100; i += 1) {
        const state = await (await req(`/transcript-burn-ins/${jobId}`, token)).json() as { state: string; file_id?: string; error?: string };
        if (state.state !== "running") return state;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("burn-in did not finish");
    };
    let seen: Array<{ op: string; position?: string; lines?: Array<{ text: string }> }> = [];
    __resetBurnJobsForTests();
    __setBurnRunnerForTests(async (request) => { seen = request.ops as typeof seen; return { ok: true, bytes: new Uint8Array([1, 2, 3, 4]), seconds: 1, width: 2, height: 2, audio: false, ms: 1 }; });
    const file = "/tmp/sample.mp4";
    try {
      expect((await start()).status).toBe(404);
      expect(seen.length).toBe(0);
      await Bun.write(file, new Uint8Array([9, 9, 9, 9]));
      const started = await start();
      expect(started.status).toBe(202);
      const done = await waitDone((await started.json() as { id: string }).id);
      expect(done.state).toBe("done");
      expect(done.file_id).toBeTruthy();
      expect(seen[0]).toMatchObject({ op: "captions", position: "top" });
      expect(seen[0]!.lines![0]!.text).toContain("Sage speaks");

      __setBurnRunnerForTests(async () => ({ ok: false, code: "failed", line: "I couldn't change that video. The edit did not finish. Try again, or change what you asked for." }));
      const failed = await waitDone((await (await start()).json() as { id: string }).id);
      expect(failed).toMatchObject({ state: "failed", error: expect.stringContaining("Try again") });
      expect((await req(`/transcript-burn-ins/nope`, token)).status).toBe(404);
      expect((await req(`/transcripts/${record.id}/caption-tracks/nope/burn-in`, token, "POST", {})).status).toBe(404);
    } finally { __setBurnRunnerForTests(null); await Bun.file(file).delete().catch(() => undefined); }
  });
});
