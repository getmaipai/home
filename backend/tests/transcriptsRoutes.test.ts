import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@/db";
import { mediaItems, mediaSources, people, sessions } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
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

    const made = await req("/library/media-caption01/transcript", token, "POST", {});
    expect(made.status).toBe(201);
    const record = await made.json() as { id: string };
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
