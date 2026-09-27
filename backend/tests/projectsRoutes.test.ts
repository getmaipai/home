// PROJECT-START-01: GET /api/projects/:id (progress) and POST /api/
// projects/:id/cancel, mirroring artifactsRoutes.test.ts's own fixtures
// and access-matrix shape (owner/child, a person's own record vs.
// another's).
import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import * as llm from "@/lib/llm";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { conversationTurns } from "@/db/schema";
import { runStartProjectTool } from "@/lib/projects/tool";
import { registerProjectType, __resetProjectTypesForTests } from "@/lib/projects/projectTypes";
import { __resetRunnerForTests, waitForSettled } from "@/lib/projects/runner";
import type { PersonRow } from "@/types";

// The registry has no built-in of its own any more (PROJECT-PKGTYPE-02,
// docs/dev.md, 2026-09-27) - a local fixture matching the retired
// built-in `bedtime-story` type's own shape, the same pattern
// startProject.test.ts uses.
function registerBedtimeStoryFixture(): void {
  registerProjectType({
    id: "bedtime-story",
    title: "a bedtime story",
    description: "Write a short, original bedtime story with a title page - for a topic that needs a real story written, not a quick answer.",
    minRole: "child",
    consequential: true,
    paramsSchema: {
      type: "object",
      required: ["topic"],
      properties: {
        topic: { type: "string", minLength: 1, description: "What the story is about." },
        readerAge: { type: "integer", minimum: 2, maximum: 12, description: "The child's age, if known." },
      },
      additionalProperties: false,
    },
    buildPlan: (params) => {
      const topic = typeof params.topic === "string" && params.topic.trim() ? params.topic.trim() : "a small adventure";
      const readerAge = typeof params.readerAge === "number" ? params.readerAge : 6;
      return {
        steps: [
          {
            id: "story",
            kind: "text",
            needs: [],
            params: {
              role: "chat",
              promptTemplate: `Write a short, gentle bedtime story for a ${readerAge}-year-old about ${topic}. Keep it kind and simple: a title, then a few short paragraphs, a happy or comforting ending.`,
              inputs: [],
            },
          },
          {
            id: "book",
            kind: "assemble",
            needs: ["story"],
            params: { assembler: "markdown-concat", inputs: ["story"] },
          },
        ],
        ceilings: { maxWallSeconds: 120, maxGeneratorJobs: 1 },
      };
    },
  });
}

beforeEach(() => {
  resetDb();
  __resetRunnerForTests();
  __resetProjectTypesForTests();
  registerBedtimeStoryFixture();
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, person };
}

async function child(owner: TestClient, name = "Bramble") {
  const res = await owner.post("/api/people", { displayName: name, role: "child" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  const person = db.select().from(people).where(eq(people.id, id)).get()!;
  return { client, person };
}

function startProjectFor(actor: PersonRow) {
  const result = resolveOrCreateConversation(actor, "chat");
  if (!result.ok) throw new Error(result.error);
  const conversationId = result.value.id;
  const turnId = newConversationTurnId();
  db.insert(conversationTurns)
    .values({ id: turnId, personId: actor.id, surface: "chat", conversationId, userText: "write me a bedtime story", replyText: "starting now", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() })
    .run();
  const outcome = runStartProjectTool({ actor, args: { type: "bedtime-story", params: { topic: "a brave little fox" } }, callId: "c1", conversationId, turnId, temporary: false });
  const projectId = (outcome.result?.data as { projectId: string }).projectId;
  return { projectId, conversationId, turnId };
}

describe("GET /api/projects/:id", () => {
  test("the owner reads their own project's current state", async () => {
    const neverResolves = spyOn(llm, "complete").mockImplementation(() => new Promise(() => {}));
    const { client, person } = await owner();
    const { projectId } = startProjectFor(person);

    const res = await client.get(`/api/projects/${projectId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; type: string; state: string; steps: unknown[] };
    expect(body.id).toBe(projectId);
    expect(body.type).toBe("bedtime-story");
    expect(["planned", "running"]).toContain(body.state);
    expect(Array.isArray(body.steps)).toBe(true);

    neverResolves.mockRestore();
  });

  test("an unknown id is a 404, not a 500", async () => {
    const { client } = await owner();
    const res = await client.get("/api/projects/proj-doesnotexist");
    expect(res.status).toBe(404);
  });

  // PROJECT-PROGRESS-01: `posted_artifact` is null while the project's
  // deliverable hasn't posted yet, and carries the real {id, version}
  // the moment post.ts's own createArtifact() call lands - the field
  // the live progress card reads to show the finished document without
  // waiting for a reload.
  test("posted_artifact is null while the project is running, then carries the real id and version once it finishes", async () => {
    const { client, person } = await owner();
    let release: (() => void) | undefined;
    const completeSpy = spyOn(llm, "complete").mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ ok: true, value: { text: "Once upon a time.", model: "stub" } }); }),
    );
    const { projectId } = startProjectFor(person);

    const running = await client.get(`/api/projects/${projectId}`);
    expect(running.status).toBe(200);
    const runningBody = (await running.json()) as { posted_artifact: unknown };
    expect(runningBody.posted_artifact).toBeNull();

    release!();
    await waitForSettled(projectId);

    const done = await client.get(`/api/projects/${projectId}`);
    expect(done.status).toBe(200);
    const doneBody = (await done.json()) as { state: string; posted_artifact: { id: string; version: number } | null };
    expect(doneBody.state).toBe("done");
    expect(doneBody.posted_artifact).toEqual({ id: expect.any(String), version: 1 });

    completeSpy.mockRestore();
  });

  test("a child cannot read another person's project", async () => {
    const neverResolves = spyOn(llm, "complete").mockImplementation(() => new Promise(() => {}));
    const { client: ownerClient, person: ownerPerson } = await owner();
    const { client: childClient } = await child(ownerClient);
    const { projectId } = startProjectFor(ownerPerson);

    const res = await childClient.get(`/api/projects/${projectId}`);
    expect(res.status).toBe(404);

    neverResolves.mockRestore();
  });
});

describe("POST /api/projects/:id/cancel", () => {
  test("the owner cancels their own running project", async () => {
    const neverResolves = spyOn(llm, "complete").mockImplementation(() => new Promise(() => {}));
    const { client, person } = await owner();
    const { projectId } = startProjectFor(person);

    const res = await client.post(`/api/projects/${projectId}/cancel`);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("cancelled");

    neverResolves.mockRestore();
  });

  test("a child cannot cancel another person's project", async () => {
    const neverResolves = spyOn(llm, "complete").mockImplementation(() => new Promise(() => {}));
    const { client: ownerClient, person: ownerPerson } = await owner();
    const { client: childClient } = await child(ownerClient);
    const { projectId } = startProjectFor(ownerPerson);

    const res = await childClient.post(`/api/projects/${projectId}/cancel`);
    expect(res.status).toBe(404);

    neverResolves.mockRestore();
  });

  test("cancelling an already-finished project is a 409, not a silent success", async () => {
    const completeSpy = spyOn(llm, "complete").mockImplementation(async () => ({ ok: true, value: { text: "Once upon a time.", model: "stub" } }));
    const { client, person } = await owner();
    const { projectId } = startProjectFor(person);
    // Let the (fast, stubbed) project actually run to completion before
    // asking to cancel it - runStartProjectTool() itself only starts the
    // background actor, it doesn't wait for it.
    await waitForSettled(projectId);

    const res = await client.post(`/api/projects/${projectId}/cancel`);
    expect(res.status).toBe(409);

    completeSpy.mockRestore();
  });

  test("an unknown id is a 404, not a 500", async () => {
    const { client } = await owner();
    const res = await client.post("/api/projects/proj-doesnotexist/cancel");
    expect(res.status).toBe(404);
  });
});
