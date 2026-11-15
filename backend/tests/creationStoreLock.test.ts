import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { storeFile } from "@/lib/attachments";
import { recordCreation } from "@/lib/creations/store";
import { household } from "./fixtures/adultLock";

beforeEach(() => resetDb());

describe("creation store lock marks", () => {
  test("a join of unlabeled sources is all-ages and unlocked", async () => {
    const h = await household();
    const actor = h.row("Marlow");
    const sources = ["one", "two"].map((name) => {
      const file = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([name === "one" ? 1 : 2]), provenance: `video-edit:{"source":"${name}"}`, retention: "kept", deduplicate: false });
      if (!file.ok) throw new Error(file.error);
      return file.value.id;
    });
    const made = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([3]), provenance: "video-edit:{}", retention: "kept", deduplicate: false });
    if (!made.ok) throw new Error(made.error);

    const record = recordCreation(actor, { kind: "video", fileIds: [made.value.id], sources: sources.map((file_id) => ({ file_id, role: "clip" })), recipe: { tool: "video", route: "film" } });
    expect(record).toMatchObject({ made_audience: "all-ages", lock: "off" });
  });

  test("an adult-only source with its lock on decides over an unlabeled source", async () => {
    const h = await household();
    const actor = h.row("Marlow");
    const unlabeled = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([1]), provenance: "video-edit:{}", retention: "kept", deduplicate: false });
    const labeled = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([2]), provenance: 'video-edit:{"audience":"adult-only","made_audience":"adult-only","lock":"on"}', retention: "kept", deduplicate: false });
    const made = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([3]), provenance: "video-edit:{}", retention: "kept", deduplicate: false });
    if (!unlabeled.ok || !labeled.ok || !made.ok) throw new Error("failed to store fixture file");

    const record = recordCreation(actor, { kind: "video", fileIds: [made.value.id], sources: [{ file_id: unlabeled.value.id, role: "clip" }, { file_id: labeled.value.id, role: "clip" }], recipe: { tool: "video", route: "film" } });
    expect(record).toMatchObject({ made_audience: "adult-only", lock: "on" });
  });

  test("an adult-only source whose lock the creator cleared decides with its lock off", async () => {
    const h = await household();
    const actor = h.row("Marlow");
    const unlabeled = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([1]), provenance: "video-edit:{}", retention: "kept", deduplicate: false });
    const labeled = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([2]), provenance: 'video-edit:{"audience":"adult-only","made_audience":"adult-only","lock":"off"}', retention: "kept", deduplicate: false });
    const made = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([3]), provenance: "video-edit:{}", retention: "kept", deduplicate: false });
    if (!unlabeled.ok || !labeled.ok || !made.ok) throw new Error("failed to store fixture file");

    const record = recordCreation(actor, { kind: "video", fileIds: [made.value.id], sources: [{ file_id: unlabeled.value.id, role: "clip" }, { file_id: labeled.value.id, role: "clip" }], recipe: { tool: "video", route: "film" } });
    expect(record).toMatchObject({ made_audience: "adult-only", lock: "off" });
  });

  test("a single unlabeled source produces an all-ages unlocked creation", async () => {
    const h = await household();
    const actor = h.row("Marlow");
    const source = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([1]), provenance: "video-edit:{}", retention: "kept", deduplicate: false });
    const made = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([2]), provenance: "video-edit:{}", retention: "kept", deduplicate: false });
    if (!source.ok || !made.ok) throw new Error("failed to store fixture file");

    const record = recordCreation(actor, { kind: "video", fileIds: [made.value.id], sources: [{ file_id: source.value.id, role: "clip" }], recipe: { tool: "video", route: "film" } });
    expect(record).toMatchObject({ made_audience: "all-ages", lock: "off" });
  });
});
