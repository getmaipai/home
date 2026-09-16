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
    const adapter = createLocalImageAttachmentAdapter({ onRecord: (record) => records.push(record) });
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

  test("refuses safely before completing an image for a text-only engine", async () => {
    const adapter = createLocalImageAttachmentAdapter();
    const pending = await adapter.add({ file: new File(["hi"], "photo.jpg", { type: "image/jpeg" }) }) as PendingAttachment;

    await expect(adapter.send(pending)).rejects.toThrow(IMAGE_VISION_UNAVAILABLE_MESSAGE);
    expect(stagedImageAttachment(pending.id)).toBeDefined();
  });

  test("remove clears the staged local record", async () => {
    const removed: string[] = [];
    const adapter = createLocalImageAttachmentAdapter({ onRemove: (id) => removed.push(id) });
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
