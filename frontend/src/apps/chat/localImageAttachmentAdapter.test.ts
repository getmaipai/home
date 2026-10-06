import { afterEach, describe, expect, test } from "bun:test";
import type { PendingAttachment } from "@assistant-ui/react";
import {
  clearStagedImageAttachments,
  createLocalImageAttachmentAdapter,
  stagedImageAttachment,
  type LocalImageAttachmentRecord,
} from "@/apps/chat/localImageAttachmentAdapter";

afterEach(() => clearStagedImageAttachments());

describe("local image attachment adapter", () => {
  test("adds a previewable pending image and records its local digest", async () => {
    const records: LocalImageAttachmentRecord[] = [];
    const adapter = createLocalImageAttachmentAdapter({
      onRecord: (record) => records.push(record),
    });
    const pending = await adapter.add({ file: new File(["hello"], "note.png", { type: "image/png" }) }) as PendingAttachment;

    expect(pending.type).toBe("image");
    expect(pending.name).toBe("note.png");
    expect(pending.status).toEqual({ type: "requires-action", reason: "composer-send" });
    expect(records).toEqual([{
      id: pending.id,
      mediaType: "image/png",
      size: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      retention: "conversation",
      provenance: "composer:upload",
    }]);
    expect(stagedImageAttachment(pending.id)).toEqual(records[0]);
  });

  test("sends only an empty attachment part while upload happens at the turn boundary", async () => {
    const adapter = createLocalImageAttachmentAdapter();
    const pending = await adapter.add({ file: new File(["hi"], "photo.jpg", { type: "image/jpeg" }) }) as PendingAttachment;
    const complete = await adapter.send(pending);

    expect(complete.status).toEqual({ type: "complete" });
    expect(complete.content).toEqual([]);
  });

  test("hides image accept types and refuses add when a child's setting is off", async () => {
    const adapter = createLocalImageAttachmentAdapter({ enabled: () => false });
    expect(adapter.accept).not.toContain("image/*");
    await expect(adapter.add({ file: new File(["hi"], "photo.jpg", { type: "image/jpeg" }) })).rejects.toThrow("Photo uploads are turned off");
  });

  test("stages images even when the chat engine cannot read them yet", async () => {
    const adapter = createLocalImageAttachmentAdapter();
    const pending = await adapter.add({ file: new File(["hi"], "photo.jpg", { type: "image/jpeg" }) }) as PendingAttachment;
    expect((await adapter.send(pending)).content).toEqual([]);
  });

  test("remove clears the staged local record", async () => {
    const removed: string[] = [];
    const adapter = createLocalImageAttachmentAdapter({
      onRemove: (id) => removed.push(id),
    });
    const pending = await adapter.add({ file: new File(["hi"], "photo.jpg", { type: "image/jpeg" }) }) as PendingAttachment;
    await adapter.remove(pending);

    expect(stagedImageAttachment(pending.id)).toBeUndefined();
    expect(removed).toEqual([pending.id]);
  });

  test("bounds the local upload and keeps the adapter image-only", async () => {
    const adapter = createLocalImageAttachmentAdapter();
    await expect(adapter.add({ file: new File(["text"], "note.txt", { type: "text/plain" }) })).rejects.toThrow("image files");
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", { type: "image/png" });
    await expect(adapter.add({ file: oversized })).rejects.toThrow("You can add up to 4 pictures, each up to 10 MB.");
  });

  test("stages PDF bytes locally and exposes them only as a send payload", async () => {
    const adapter = createLocalImageAttachmentAdapter();
    const pending = await adapter.add({ file: new File(["pdf bytes"], "note.pdf", { type: "application/pdf" }) }) as PendingAttachment;
    expect(pending.type).toBe("file");
    expect(await import("@/apps/chat/localImageAttachmentAdapter").then((m) => m.stagedDocumentPayload(pending.id))).toEqual({
      name: "note.pdf", mediaType: "application/pdf", data: "data:application/pdf;base64,cGRmIGJ5dGVz",
    });
    await adapter.remove(pending);
    expect(await import("@/apps/chat/localImageAttachmentAdapter").then((m) => m.stagedDocumentPayload(pending.id))).toBeUndefined();
  });

  test("rejects an unsupported document and an oversized document at pick time", async () => {
    const adapter = createLocalImageAttachmentAdapter();
    await expect(adapter.add({ file: new File(["x"], "x.bin", { type: "application/octet-stream" }) })).rejects.toThrow("image files");
    await expect(adapter.add({ file: new File([new Uint8Array(50 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" }) })).rejects.toThrow("under 50 MB");
  });
});
