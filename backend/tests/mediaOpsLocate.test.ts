import { afterEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { settingsValues } from "@/db/schema";
import { removeTemporaryChatImages, storeTemporaryChatImage } from "@/lib/attachments";
import { __setImageToolsForTests, startComment, startEdit } from "@/lib/imageEdit";
import { __resetAdapterCacheForTests } from "@/lib/pictures/adapters";
import { runPictureTool } from "@/lib/pictures/people";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";
import { testPng } from "./pictureFixture";
import { runMediaOp } from "@/lib/mediaOps/registry";

const sampleBoxes = [
  { id: 3, x: 0.12, y: 0.2, w: 0.3, h: 0.4 },
  { id: 8, x: 0.61, y: 0.1, w: 0.2, h: 0.5 },
];

function addOwner(): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id: "person-locateowner", displayName: "Owner", role: "owner", avatarSeed: "owner", source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(people).all().find((row) => row.id === "person-locateowner")!;
}

function imageToolsStub(imageEdit: (form: FormData) => Promise<unknown>) {
  __setStackClientForTests({ imageEdit } as unknown as StackClient);
}

function allowPhotos(actor: PersonRow) {
  db.insert(settingsValues).values({ scope: `person:${actor.id}`, key: "chat.photo_uploads", value: "true", hlc: "1:0:test", source: "self", setBy: actor.id, updatedAt: new Date().toISOString() }).run();
}

afterEach(() => {
  removeTemporaryChatImages("locate-conversation");
  __setImageToolsForTests(undefined);
  __setPictureStatusForTests(undefined);
  __setPicturesFetchForTests(null);
  __resetAdapterCacheForTests();
  __setStackClientForTests(null);
  __resetStackEngineForTests();
});

describe("picture people operations", () => {
  test("edit_picture registry passes both combine references and returns locate boxes as model data", async () => {
    resetDb();
    const actor = addOwner();
    allowPhotos(actor);
    const bytes = await testPng();
    for (const id of ["registry-base", "registry-ref-1", "registry-ref-2"]) storeTemporaryChatImage({ id, turnId: "turn-1", conversationId: "locate-conversation", ownerPersonId: actor.id, name: `${id}.png`, mediaType: "image/png", width: 64, height: 64, bytes, generated: true });
    __setImageToolsForTests({ state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: {}, operations: [], reason: null }, true);
    __setPictureStatusForTests(readyStatusForTests());
    const edits: FormData[] = [];
    __setPicturesFetchForTests((async (_input, init) => { edits.push(init?.body as FormData); return new Response(JSON.stringify({ job: "combine-job" }), { status: 202, headers: { "content-type": "application/json" } }); }) as typeof fetch);
    const changed = await runMediaOp(actor, "picture.change", { source: { kind: "picture", via: "chat", id: "registry-base", conversationId: "locate-conversation" }, args: { prompt: "combine these pictures", references: ["registry-ref-1", "registry-ref-2"].map((id) => ({ kind: "picture", via: "chat", id, conversationId: "locate-conversation" })) } });
    expect("job" in changed && changed.job.job).toBe("combine-job");
    expect(edits[0]?.get("reference_source")).toBe("generated");
    expect(edits[0]?.get("reference2_source")).toBe("generated");

    imageToolsStub(async () => ({ kind: "done", job: "locate-job", item: { b64_json: "", width: 64, height: 64, content_type: "image/png", operation: "find_subjects", subjects: [{ id: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.4, kind: "animal", label: "dog" }] } }));
    const located = await runMediaOp(actor, "picture.locate", { source: { kind: "picture", via: "chat", id: "registry-base", conversationId: "locate-conversation" }, args: {} });
    expect(located).toMatchObject({ subjects: [{ n: 2, kind: "animal", label: "dog" }] });
  });

  test("find_people returns the Stack's numbered fractional boxes", async () => {
    let submitted: FormData | undefined;
    imageToolsStub(async (form) => {
      submitted = form;
      return {
        kind: "done",
        job: "people-job",
        item: {
          b64_json: "",
          width: 100,
          height: 80,
          content_type: "image/png",
          operation: "find_people",
          people: sampleBoxes,
        },
      };
    });

    const result = await runPictureTool("find_people", new Uint8Array([1]), "image/png", {});

    expect(submitted?.get("operation")).toBe("find_people");
    expect(result.people).toEqual(sampleBoxes);
  });

  test("find_subjects returns detector labels and kinds", async () => {
    let submitted: FormData | undefined;
    imageToolsStub(async (form) => {
      submitted = form;
      return { kind: "done", job: "subjects-job", item: { b64_json: "", width: 100, height: 80, content_type: "image/png", operation: "find_subjects", subjects: [{ id: 4, x: 0.1, y: 0.2, w: 0.3, h: 0.4, kind: "animal", label: "dog" }] } };
    });
    const result = await runPictureTool("find_subjects", new Uint8Array([1]), "image/png", {});
    expect(submitted?.get("operation")).toBe("find_subjects");
    expect(result.subjects).toEqual([{ id: 4, x: 0.1, y: 0.2, w: 0.3, h: 0.4, kind: "animal", label: "dog" }]);
  });

  test("erase with people sends erase_people and neither target is refused", async () => {
    resetDb();
    const actor = addOwner();
    const bytes = await testPng();
    storeTemporaryChatImage({
      id: "erase-source",
      turnId: "turn-1",
      conversationId: "locate-conversation",
      ownerPersonId: actor.id,
      name: "picture.png",
      mediaType: "image/png",
      width: 64,
      height: 64,
      bytes,
    });
    __setImageToolsForTests({ state: "idle", phase: null, vision: true, models: { lama: true }, limits: {}, operations: [], reason: null }, true);
    let submitted: FormData | undefined;
    imageToolsStub(async (form) => {
      submitted = form;
      return { kind: "running", job: "erase-job" };
    });

    await expect(startEdit(actor, "locate-conversation", "erase-source", { operation: "erase", people: "1,3" })).resolves.toMatchObject({ state: "running" });
    expect(submitted?.get("operation")).toBe("erase_people");
    expect(submitted?.get("people")).toBe("1,3");
    await expect(startEdit(actor, "locate-conversation", "erase-source", { operation: "erase" })).rejects.toMatchObject({ status: 422 });
  });

  test("erase with subjects sends Stack erase_subjects and the subjects form field", async () => {
    resetDb();
    const actor = addOwner();
    const bytes = await testPng();
    storeTemporaryChatImage({ id: "erase-subject", turnId: "turn-1", conversationId: "locate-conversation", ownerPersonId: actor.id, name: "picture.png", mediaType: "image/png", width: 64, height: 64, bytes });
    __setImageToolsForTests({ state: "idle", phase: null, vision: true, models: { lama: true }, limits: {}, operations: ["find_subjects"], reason: null }, true);
    let submitted: FormData | undefined;
    imageToolsStub(async (form) => { submitted = form; return { kind: "running", job: "erase-subject-job" }; });
    await expect(startEdit(actor, "locate-conversation", "erase-subject", { operation: "erase", subjects: "2,4" })).resolves.toMatchObject({ state: "running" });
    expect(submitted?.get("operation")).toBe("erase_subjects");
    expect(submitted?.get("subjects")).toBe("2,4");
  });

  test("change sends up to the Stack reference count and refuses the next one", async () => {
    resetDb();
    const actor = addOwner();
    const bytes = await testPng();
    // ADULT-LOCK-07: an adult-only temp picture is unreadable without an unlock proof, so the reference-count test uses all-ages pictures.
    for (const [id, audience] of [["change-base", "all-ages"], ["ref-one", "all-ages"], ["ref-two", "all-ages"], ["ref-three", "all-ages"]] as const) {
      storeTemporaryChatImage({
        id,
        turnId: "turn-1",
        conversationId: "locate-conversation",
        ownerPersonId: actor.id,
        name: `${id}.png`,
        mediaType: "image/png",
        width: 64,
        height: 64,
        bytes,
        generated: true,
        audience,
      });
    }
    __setImageToolsForTests(null, true);
    __setPictureStatusForTests(readyStatusForTests());
    const submitted: FormData[] = [];
    __setPicturesFetchForTests((async (_input, init) => {
      submitted.push(init?.body as FormData);
      return new Response(JSON.stringify({ job: `edit-${submitted.length}` }), { status: 202, headers: { "content-type": "application/json" } });
    }) as typeof fetch);

    await startComment(actor, "locate-conversation", "change-base", { prompt: "make the background blue" });
    await startComment(actor, "locate-conversation", "change-base", {
      prompt: "make the background blue",
      references: [{ kind: "picture", via: "chat", id: "ref-one" }],
    });
    await startComment(actor, "locate-conversation", "change-base", {
      prompt: "make the background blue",
      references: [
        { kind: "picture", via: "chat", id: "ref-one" },
        { kind: "picture", via: "chat", id: "ref-two" },
      ],
    });
    await expect(startComment(actor, "locate-conversation", "change-base", {
      prompt: "make the background blue",
      references: [
        { kind: "picture", via: "chat", id: "ref-one" },
        { kind: "picture", via: "chat", id: "ref-two" },
        { kind: "picture", via: "chat", id: "ref-three" },
      ],
    })).rejects.toMatchObject({ status: 422, code: "references_unsupported" });

    expect(submitted).toHaveLength(3);
    expect(submitted[0]!.get("reference")).toBeNull();
    expect(submitted[1]!.get("reference_source")).toBe("generated");
    expect(submitted[2]!.get("reference2_source")).toBe("generated");
  });

  test("change refuses unknown styles and reports supported styles as not available yet", async () => {
    resetDb();
    const actor = addOwner();
    storeTemporaryChatImage({
      id: "style-base",
      turnId: "turn-1",
      conversationId: "locate-conversation",
      ownerPersonId: actor.id,
      name: "style-base.png",
      mediaType: "image/png",
      width: 64,
      height: 64,
      bytes: await testPng(),
      generated: true,
    });
    let editPosts = 0;
    __setPicturesFetchForTests((async (input) => {
      const url = String(input);
      if (url.endsWith("/stack/v1/image/loras")) {
        return new Response(JSON.stringify({ loras: [{
          id: "lora-cccccccccccccccc",
          name: "Watercolor",
          sha256: "a".repeat(64),
          bytes: 1,
          base_model: "base",
          licence: null,
          source_url: null,
          classification: "all-ages",
          trigger_words: [],
          strength_default: 1,
          added_at: new Date().toISOString(),
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      editPosts += 1;
      return new Response(JSON.stringify({ job: "unexpected" }), { status: 202, headers: { "content-type": "application/json" } });
    }) as typeof fetch);

    await expect(startComment(actor, "locate-conversation", "style-base", { prompt: "change the scene", styles: ["not a saved style"] }))
      .rejects.toMatchObject({ status: 422, code: "style_unavailable" });
    await expect(startComment(actor, "locate-conversation", "style-base", { prompt: "change the scene", styles: ["Watercolor"] }))
      .rejects.toMatchObject({ status: 501, code: "styles_not_available" });
    expect(editPosts).toBe(0);
  });
});
