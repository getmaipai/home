import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { createArtifact, updateArtifact, getArtifactRow, currentArtifactRow, visibleArtifactRow, toArtifact } from "@/lib/artifacts";

beforeEach(() => resetDb());

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

function child(displayName = "Bramble") {
  return db
    .insert(people)
    .values({ id: `person-${displayName.toLowerCase()}`, displayName, role: "child", avatarSeed: "bench", source: "test", localOnly: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: nextHlc() })
    .returning()
    .get()!;
}

function conversationFor(actor: typeof people.$inferSelect) {
  const result = resolveOrCreateConversation(actor, "chat");
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

function turnFor(actor: typeof people.$inferSelect, conversationId: string, safetyAction: "allow" | "allow_with_resources" | "refuse" = "allow") {
  const id = newConversationTurnId();
  db.insert(conversationTurns)
    .values({
      id,
      personId: actor.id,
      surface: "chat",
      conversationId,
      userText: "write me a packing list",
      replyText: "here's a packing list",
      source: "model",
      safetyAction,
      createdAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .run();
  return id;
}

describe("createArtifact / updateArtifact", () => {
  test("a first version has no parent and is current", async () => {
    const actor = await owner();
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);
    const v1 = createArtifact({ conversationId, turnId, kind: "markdown", title: "Packing list", body: "- Tent\n", createdBy: actor.id, provenance: `artifact-tool:${turnId}` });
    expect(v1.version).toBe(1);
    expect(v1.parent_version).toBeNull();
    const row = getArtifactRow(v1.id)!;
    expect(row.isCurrent).toBe(true);
    expect(currentArtifactRow(row.artifactKey)?.id).toBe(v1.id);
  });

  test("an update chains to the prior version and flips the current pointer", async () => {
    const actor = await owner();
    const conversationId = conversationFor(actor);
    const turn1 = turnFor(actor, conversationId);
    const v1 = createArtifact({ conversationId, turnId: turn1, kind: "markdown", title: "Packing list", body: "- Tent\n", createdBy: actor.id, provenance: `artifact-tool:${turn1}` });

    const turn2 = turnFor(actor, conversationId);
    const result = updateArtifact({ currentId: v1.id, body: "- Tent\n- Rain jacket\n", turnId: turn2, createdBy: actor.id, provenance: `artifact-tool:${turn2}` });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) return;
    const v2 = result.value;
    expect(v2.version).toBe(2);
    expect(v2.parent_version).toBe(v1.id);
    expect(v2.title).toBe("Packing list");

    expect(getArtifactRow(v1.id)!.isCurrent).toBe(false);
    const row2 = getArtifactRow(v2.id)!;
    expect(row2.isCurrent).toBe(true);
    expect(currentArtifactRow(row2.artifactKey)?.id).toBe(v2.id);
  });

  test("updating a superseded version is refused", async () => {
    const actor = await owner();
    const conversationId = conversationFor(actor);
    const turn1 = turnFor(actor, conversationId);
    const v1 = createArtifact({ conversationId, turnId: turn1, kind: "markdown", title: "Packing list", body: "- Tent\n", createdBy: actor.id, provenance: `artifact-tool:${turn1}` });
    const turn2 = turnFor(actor, conversationId);
    updateArtifact({ currentId: v1.id, body: "- Tent\n- Rain jacket\n", turnId: turn2, createdBy: actor.id, provenance: `artifact-tool:${turn2}` });

    const turn3 = turnFor(actor, conversationId);
    const stale = updateArtifact({ currentId: v1.id, body: "- Tent\n- Boots\n", turnId: turn3, createdBy: actor.id, provenance: `artifact-tool:${turn3}` });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.status).toBe(409);
  });

  test("round-trips through the spec's Artifact schema", async () => {
    const actor = await owner();
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);
    const v1 = createArtifact({ conversationId, turnId, kind: "html", title: "A page", body: "<p>hi</p>", createdBy: actor.id, provenance: `artifact-tool:${turnId}` });
    expect(toArtifact(getArtifactRow(v1.id)!)).toEqual(v1);
  });
});

describe("visibleArtifactRow", () => {
  test("an adult sees any artifact from a turn they can access", async () => {
    const actor = await owner();
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);
    const v1 = createArtifact({ conversationId, turnId, kind: "markdown", title: "Packing list", body: "- Tent\n", createdBy: actor.id, provenance: `artifact-tool:${turnId}` });
    expect(visibleArtifactRow(actor, getArtifactRow(v1.id)!)).toBe(true);
  });

  test("a child sees their own artifact from a turn that passed safety", () => {
    const kid = child();
    const conversationId = conversationFor(kid);
    const turnId = turnFor(kid, conversationId, "allow");
    const v1 = createArtifact({ conversationId, turnId, kind: "markdown", title: "My list", body: "- toy\n", createdBy: kid.id, provenance: `artifact-tool:${turnId}` });
    expect(visibleArtifactRow(kid, getArtifactRow(v1.id)!)).toBe(true);
  });

  test("a child does not see an artifact from a turn that was safety-refused", async () => {
    const kid = child();
    const conversationId = conversationFor(kid);
    const turnId = turnFor(kid, conversationId, "refuse");
    // A refused turn would not really produce an artifact today, but the
    // access check is defense in depth regardless of what the composer
    // currently does - insert directly to prove the gate on its own.
    const v1 = createArtifact({ conversationId, turnId, kind: "markdown", title: "My list", body: "- toy\n", createdBy: kid.id, provenance: `artifact-tool:${turnId}` });
    expect(visibleArtifactRow(kid, getArtifactRow(v1.id)!)).toBe(false);
  });

  test("a child does not see another person's artifact", async () => {
    const owner_ = await owner();
    const kid = child();
    const conversationId = conversationFor(owner_);
    const turnId = turnFor(owner_, conversationId);
    const v1 = createArtifact({ conversationId, turnId, kind: "markdown", title: "Adult's list", body: "- car keys\n", createdBy: owner_.id, provenance: `artifact-tool:${turnId}` });
    expect(visibleArtifactRow(kid, getArtifactRow(v1.id)!)).toBe(false);
  });
});
