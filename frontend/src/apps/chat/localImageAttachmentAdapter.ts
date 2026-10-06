import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from "@assistant-ui/react";
import { MAX_CHAT_IMAGES, MAX_CHAT_IMAGE_BYTES, CHAT_IMAGE_REFUSAL } from "@maipai/home-backend/src/wire";

const MAX_IMAGE_BYTES = MAX_CHAT_IMAGE_BYTES;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const DOCUMENT_TYPES = new Set(["application/pdf", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet", "application/vnd.oasis.opendocument.presentation"]);
const stagedDocuments = new Map<string, File>();

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
  enabled?: () => boolean;
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
    throw new Error(CHAT_IMAGE_REFUSAL);
  }
}

/** ATT-01d: the assistant-ui contract, with local digest bookkeeping added.
 * Live finding 2026-09-22: the capability check used to live in `send`,
 * on the theory that `add` should succeed so a person can preview and
 * remove a staged image without sending it anywhere - but assistant-ui's
 * own composer.send() rejects the WHOLE send when any attachment's own
 * send() throws (base-composer-runtime-core.js), and nothing in Home's
 * composer catches that rejection - the person saw nothing happen at
 * all, not an error. `add`'s own rejection path is the one that already
 * works (the same one `validateImage`'s existing checks already use):
 * the runtime reports it as a `composer.attachmentAddError` event (no tile
 * is created), which composerAddMenu.tsx shows as one plain toast
 * (UPLOAD-IMG-02). Checked here instead - a photo is refused the moment
 * it's picked, with the real reason, never a silently dead Send button. */
export function createLocalImageAttachmentAdapter(options: LocalImageAttachmentAdapterOptions = {}): AttachmentAdapter {

  const imagesEnabled = options.enabled?.() !== false;
  return {
    accept: imagesEnabled ? "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp" : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp",

    async add({ file }): Promise<PendingAttachment> {
      if (DOCUMENT_TYPES.has(file.type.toLowerCase())) {
        if (file.size > MAX_DOCUMENT_BYTES) throw new Error("That document is too large. Choose one under 50 MB.");
        const id = newLocalAttachmentId();
        stagedDocuments.set(id, file);
        return { id, type: "file", name: file.name, contentType: file.type, file, status: { type: "requires-action", reason: "composer-send" } };
      }
      validateImage(file);
      if (options.enabled?.() === false) throw new Error("Photo uploads are turned off for this profile.");
      if (stagedRecords.size >= MAX_CHAT_IMAGES) throw new Error(CHAT_IMAGE_REFUSAL);
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
      const doc = stagedDocuments.get(attachment.id);
      if (doc) return { ...attachment, status: { type: "complete" }, content: [{ type: "text", text: `Document: ${doc.name}` }] };
      if (options.enabled?.() === false) throw new Error("Photo uploads are turned off for this profile.");
      validateImage(attachment.file);
      return {
        ...attachment,
        status: { type: "complete" },
        // UPLOAD-IMG-01: bytes are uploaded to the hub before the turn. The
        // user message carries only the returned id and display metadata.
        content: [],
      };
    },

    async remove(attachment): Promise<void> {
      stagedDocuments.delete(attachment.id);
      stagedRecords.delete(attachment.id);
      options.onRemove?.(attachment.id);
    },
  };
}

export function stagedImageAttachment(id: string): LocalImageAttachmentRecord | undefined {
  return stagedRecords.get(id);
}

export function clearStagedImageAttachment(id: string): void {
  stagedRecords.delete(id);
}

export function clearStagedImageAttachments(): void {
  stagedRecords.clear();
  stagedDocuments.clear();
}

export async function stagedDocumentPayload(id: string): Promise<{ name: string; mediaType: string; data: string } | undefined> {
  const file = stagedDocuments.get(id);
  if (!file) return undefined;
  return { name: file.name, mediaType: file.type.toLowerCase(), data: await fileDataURL(file) };
}

export { MAX_IMAGE_BYTES };
