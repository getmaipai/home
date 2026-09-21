// ARTIFACT-02: host.artifact.create/update (packageHost.ts) against a
// real turn and a real @maipai/spec-shaped Artifact row - lib/artifacts.ts's
// own createArtifact/updateArtifact are covered directly by
// tests/artifacts.test.ts (version chaining, the child-safety visibility
// gate); this file proves the HOST layer on top of that: permission
// gating, the conversation_id lookup from a bound turnId, the identical
// provenance expression memory.remember() already uses, and the one
// check lib/artifacts.ts itself has no way to make - a non-owner cannot
// supersede someone else's artifact through this path.
import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { getArtifactRow, visibleArtifactRow } from "@/lib/artifacts";
import { createHost } from "@/lib/packageHost";
import { runPlugin } from "@/lib/plugins";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";

beforeEach(() => resetDb());

function manifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return PackageManifest.parse({
    id: "write_document",
    version: "0.1.0",
    kind: "plugin",
    category: "Utilities",
    display: "Write a Document",
    description: "Create or edit a document.",
    author: "test",
    license: "AGPL-3.0",
    platforms: ["home"],
    min_role: "child",
    consequential: false,
    offline: "full",
    min_app: "0.1.0",
    tier: 0,
    permissions: [],
    ...overrides,
  });
}

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

describe("packageHost artifact.create/update", () => {
  test("requires artifact:write", () => {
    const host = createHost(child(), manifest({ permissions: [] }));
    expect(() => host.artifact.create({ title: "Packing list", kind: "markdown", body: "- tent" })).toThrow(HostError);
    try {
      host.artifact.create({ title: "Packing list", kind: "markdown", body: "- tent" });
    } catch (err) {
      expect((err as HostError).code).toBe("permission_denied");
    }
  });

  test("needs a real conversation turn to attach to", () => {
    const host = createHost(child(), manifest({ permissions: ["artifact:write"] }));
    // No turnId passed to createHost() - a direct plugin run / scheduled
    // job, the same shape memory.remember() falls back to `package:<id>`
    // for, but an Artifact's turn_id is a required FK with nowhere to fall
    // back to.
    expect(() => host.artifact.create({ title: "Packing list", kind: "markdown", body: "- tent" })).toThrow(HostError);
  });

  test("create() writes a real first version with the turn's own conversation and provenance", () => {
    const actor = child();
    const conversationId = conversationFor(actor);
    const turnId = turnFor(actor, conversationId);
    const host = createHost(actor, manifest({ permissions: ["artifact:write"] }), [], turnId);

    const result = host.artifact.create({ title: "Packing list", kind: "markdown", body: "- tent\n- stove" });
    expect(result.version).toBe(1);

    const row = getArtifactRow(result.id)!;
    expect(row.conversationId).toBe(conversationId);
    expect(row.turnId).toBe(turnId);
    expect(row.createdBy).toBe(actor.id);
    // The identical provenance expression memory.remember() already uses
    // for `source` (docs/dev.md's "Provenance" note): the turn id itself.
    expect(row.provenance).toBe(turnId);
    expect(row.parentVersion).toBeNull();
    expect(row.isCurrent).toBe(true);
  });

  test("update() chains a new version and reports it through the same turn's real id", () => {
    const actor = child();
    const conversationId = conversationFor(actor);
    const turn1 = turnFor(actor, conversationId);
    const created = createHost(actor, manifest({ permissions: ["artifact:write"] }), [], turn1).artifact.create({
      title: "Packing list",
      kind: "markdown",
      body: "- tent",
    });

    const turn2 = turnFor(actor, conversationId);
    const updated = createHost(actor, manifest({ permissions: ["artifact:write"] }), [], turn2).artifact.update({
      artifact_id: created.id,
      title: "Packing list",
      body: "- tent\n- stove",
    });
    expect(updated.version).toBe(2);

    const v1 = getArtifactRow(created.id)!;
    expect(v1.isCurrent).toBe(false);
    const v2 = getArtifactRow(updated.id)!;
    expect(v2.isCurrent).toBe(true);
    expect(v2.parentVersion).toBe(created.id);
    expect(v2.turnId).toBe(turn2);
    expect(v2.provenance).toBe(turn2);
    expect(v2.body).toBe("- tent\n- stove");
  });

  test("updating an unknown artifact_id throws not_found", () => {
    const actor = child();
    const turnId = turnFor(actor, conversationFor(actor));
    const host = createHost(actor, manifest({ permissions: ["artifact:write"] }), [], turnId);
    expect(() => host.artifact.update({ artifact_id: "art-missing1", title: "x", body: "y" })).toThrow(HostError);
    try {
      host.artifact.update({ artifact_id: "art-missing1", title: "x", body: "y" });
    } catch (err) {
      expect((err as HostError).code).toBe("not_found");
    }
  });

  test("updating a superseded version throws invalid_input", () => {
    const actor = child();
    const conversationId = conversationFor(actor);
    const turn1 = turnFor(actor, conversationId);
    const v1 = createHost(actor, manifest({ permissions: ["artifact:write"] }), [], turn1).artifact.create({ title: "Packing list", kind: "markdown", body: "- tent" });
    const turn2 = turnFor(actor, conversationId);
    createHost(actor, manifest({ permissions: ["artifact:write"] }), [], turn2).artifact.update({ artifact_id: v1.id, title: "Packing list", body: "- tent\n- stove" });

    const turn3 = turnFor(actor, conversationId);
    const host3 = createHost(actor, manifest({ permissions: ["artifact:write"] }), [], turn3);
    expect(() => host3.artifact.update({ artifact_id: v1.id, title: "Packing list", body: "- tent\n- boots" })).toThrow(HostError);
    try {
      host3.artifact.update({ artifact_id: v1.id, title: "Packing list", body: "- tent\n- boots" });
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
    }
  });

  // The one check lib/artifacts.ts's own updateArtifact() has no way to
  // make itself (found writing this test: it takes currentId on faith) -
  // routes/artifacts.ts is read-only and this host method is the only
  // write path, so this is the one place ownership can be enforced.
  test("a non-owner cannot update another person's artifact", async () => {
    const owner_ = await owner();
    const kid = child();
    const conversationId = conversationFor(owner_);
    const turn1 = turnFor(owner_, conversationId);
    const v1 = createHost(owner_, manifest({ permissions: ["artifact:write"] }), [], turn1).artifact.create({ title: "Adult's list", kind: "markdown", body: "- car keys" });

    const kidTurn = turnFor(kid, conversationFor(kid));
    const kidHost = createHost(kid, manifest({ permissions: ["artifact:write"] }), [], kidTurn);
    expect(() => kidHost.artifact.update({ artifact_id: v1.id, title: "Adult's list", body: "- car keys\n- wallet" })).toThrow(HostError);
    try {
      kidHost.artifact.update({ artifact_id: v1.id, title: "Adult's list", body: "- car keys\n- wallet" });
    } catch (err) {
      // not_found, not permission_denied - the same "can't see it, so it
      // doesn't exist" convention routes/artifacts.ts's own read routes
      // already use for someone else's artifact, never revealing that
      // the id exists at all.
      expect((err as HostError).code).toBe("not_found");
    }
    // Untouched: still version 1, still the owner's.
    expect(getArtifactRow(v1.id)!.version).toBe(1);
  });

  test("a child's own artifact from an allowed turn is visible to them (the safety projection, end to end)", () => {
    const kid = child();
    const conversationId = conversationFor(kid);
    const turnId = turnFor(kid, conversationId, "allow");
    const result = createHost(kid, manifest({ permissions: ["artifact:write"] }), [], turnId).artifact.create({ title: "My list", kind: "markdown", body: "- toy" });
    expect(visibleArtifactRow(kid, getArtifactRow(result.id)!)).toBe(true);
  });
});

// The bundled write_document package's own recipe.json, through
// runPlugin() - the exact call POST /api/turn's own resolveToolCallsInOrder()
// makes for a real tool call - never a hand-assembled recipe: proves the
// artifact step and the format step it feeds actually wire together the
// way ARTIFACT-02's own acceptance criterion asks for ("a model-driven
// live chat creates then edits an artifact, TurnValue.artifact gets set
// from the real tool call").
describe("the bundled write_document package, through the real host", () => {
  test("creates, then edits in a later turn, with real versions and TurnValue.artifact's own data shape", async () => {
    const actor = child();
    const conversationId = conversationFor(actor);
    const turn1 = turnFor(actor, conversationId);

    const created = await runPlugin("write_document", actor, { title: "Packing list", kind: "markdown", body: "- tent\n- stove" }, turn1);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.reply?.text).toBe('Here\'s "Packing list".');
    // structuredPartForOutcomes() (composer.ts) reads exactly this flat
    // shape off a succeeded outcome's own result.data to set TurnValue.artifact.
    expect(created.value.data).toEqual({ artifact_id: expect.any(String), artifact_version: 1 });
    const firstId = (created.value.data as { artifact_id: string }).artifact_id;
    expect(getArtifactRow(firstId)!.version).toBe(1);

    const turn2 = turnFor(actor, conversationId);
    const edited = await runPlugin(
      "write_document",
      actor,
      { title: "Packing list", kind: "markdown", body: "- tent\n- stove\n- lantern", artifact_id: firstId },
      turn2,
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.data).toEqual({ artifact_id: expect.any(String), artifact_version: 2 });
    const secondId = (edited.value.data as { artifact_id: string }).artifact_id;
    expect(getArtifactRow(firstId)!.isCurrent).toBe(false);
    const v2 = getArtifactRow(secondId)!;
    expect(v2.isCurrent).toBe(true);
    expect(v2.parentVersion).toBe(firstId);
    expect(v2.provenance).toBe(turn2);
    expect(v2.body).toBe("- tent\n- stove\n- lantern");
  });
});
