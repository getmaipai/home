import { afterEach, describe, expect, test } from "bun:test";
import type { PendingAttachment } from "@assistant-ui/react";
import {
  clearStagedImageAttachments,
  createLocalImageAttachmentAdapter,
  stagedImageAttachment,
  type LocalImageAttachmentRecord,
} from "@/apps/chat/localImageAttachmentAdapter";
import { IMAGE_VISION_UNAVAILABLE_MESSAGE } from "@/apps/chat/visionCapability";

afterEach(() => clearStagedImageAttachments());

describe("local image attachment adapter", () => {
  test("adds a previewable pending image and records its local digest", async () => {
    const records: LocalImageAttachmentRecord[] = [];
    const adapter = createLocalImageAttachmentAdapter({
      capability: () => ({ imageParts: true, engine: "vision", transport: "local" }),
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

  test("sends a complete local image when the selected engine declares vision", async () => {
    const adapter = createLocalImageAttachmentAdapter({
      capability: () => ({ imageParts: true, engine: "vision", transport: "local" }),
    });
    const pending = await adapter.add({ file: new File(["hi"], "photo.jpg", { type: "image/jpeg" }) }) as PendingAttachment;
    const complete = await adapter.send(pending);

    expect(complete.status).toEqual({ type: "complete" });
    expect(complete.content).toEqual([{ type: "image", image: "data:image/jpeg;base64,aGk=" }]);
  });

  // Live finding 2026-09-22: this used to succeed at add() and only
  // reject at send() - assistant-ui's own composer.send() rejects the
  // WHOLE send when any attachment's send() throws, and nothing in
  // Home's composer catches that, so the person saw nothing happen at
  // all. Refused at add() instead, the moment the photo is picked - the
  // one rejection path assistant-ui's runtime already surfaces as the
  // attachment's own visible error (base-composer-runtime-core.js's
  // addAttachment(), the same path validateImage()'s existing checks
  // use), never a dead Send button.
  test("refuses a photo at attach time for a text-only engine, before it ever becomes sendable", async () => {
    const adapter = createLocalImageAttachmentAdapter();

    await expect(adapter.add({ file: new File(["hi"], "photo.jpg", { type: "image/jpeg" }) })).rejects.toThrow(IMAGE_VISION_UNAVAILABLE_MESSAGE);
  });

  test("remove clears the staged local record", async () => {
    const removed: string[] = [];
    const adapter = createLocalImageAttachmentAdapter({
      capability: () => ({ imageParts: true, engine: "vision", transport: "local" }),
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
    await expect(adapter.add({ file: oversized })).rejects.toThrow("under 10 MB");
  });
});
