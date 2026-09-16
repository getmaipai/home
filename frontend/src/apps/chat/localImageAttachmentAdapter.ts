import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from "@assistant-ui/react";
import { IMAGE_VISION_UNAVAILABLE_MESSAGE, type LocalVisionCapability } from "@/apps/chat/visionCapability";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** The browser-side portion of ATT-01's immutable local attachment record.
 * The conversation and turn references are supplied by the turn engine when
 * a message is accepted; this staging record never points at a remote store. */
export interface LocalImageAttachmentRecord {
  id: string;
  mediaType: string;
  size: number;
  sha256: string;
  retention: "conversation";
  provenance: "composer:upload";
}

export interface LocalImageAttachmentAdapterOptions {
  capability?: () => LocalVisionCapability;
  onRecord?(record: LocalImageAttachmentRecord): void;
  onRemove?(id: string): void;
}

const stagedRecords = new Map<string, LocalImageAttachmentRecord>();

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fileDataURL(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function newLocalAttachmentId(): string {
  const uuid = crypto.randomUUID?.();
  if (uuid) return `att-${uuid.replaceAll("-", "")}`;
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `att-${Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("")}`;
}

function validateImage(file: File): void {
  if (!file.type.toLowerCase().startsWith("image/")) {
    throw new Error("MaiPai can only add image files here.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("That image is too large to keep locally. Choose one under 10 MB.");
  }
}

/** ATT-01d: the assistant-ui contract, with local digest bookkeeping added.
 * `add` intentionally succeeds before capability checking so a person can
 * preview and remove a staged image without sending it anywhere. `send` is
 * where the selected engine gate is enforced. */
export function createLocalImageAttachmentAdapter(options: LocalImageAttachmentAdapterOptions = {}): AttachmentAdapter {
  const capability = options.capability ?? (() => ({ imageParts: false, engine: "text-only" as const, transport: "local" as const }));

  return {
    accept: "image/*",

    async add({ file }): Promise<PendingAttachment> {
      validateImage(file);
      const bytes = await file.arrayBuffer();
      const digest = await sha256(bytes);
      const record: LocalImageAttachmentRecord = {
        id: newLocalAttachmentId(),
        mediaType: file.type.toLowerCase(),
        size: file.size,
        sha256: digest,
        retention: "conversation",
        provenance: "composer:upload",
      };
      stagedRecords.set(record.id, record);
      options.onRecord?.(record);
      return {
        id: record.id,
        type: "image",
        name: file.name,
        contentType: file.type,
        file,
        status: { type: "requires-action", reason: "composer-send" },
      };
    },

    async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
      if (!capability().imageParts) throw new Error(IMAGE_VISION_UNAVAILABLE_MESSAGE);
      validateImage(attachment.file);
      return {
        ...attachment,
        status: { type: "complete" },
        content: [{ type: "image", image: await fileDataURL(attachment.file) }],
      };
    },

    async remove(attachment): Promise<void> {
      stagedRecords.delete(attachment.id);
      options.onRemove?.(attachment.id);
    },
  };
}

export function stagedImageAttachment(id: string): LocalImageAttachmentRecord | undefined {
  return stagedRecords.get(id);
}

export function clearStagedImageAttachments(): void {
  stagedRecords.clear();
}

export { MAX_IMAGE_BYTES };
