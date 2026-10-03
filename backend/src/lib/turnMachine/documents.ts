// THIN-7C (rule 12): document attachments on the default path, ported from
// the old path's prepareTurn() (the old engine file) with the same rules.
// Each document is checked for capacity (before it is parsed), parsed to text
// and refused with one safe line if it cannot be read; only when every
// document has passed is anything written: the turn's provisional row (the
// file's foreign-key target, the same row logTurn() later finishes in place)
// and one stored file per document, bound to the turn. A temporary chat takes
// no document at all. The model gets the message with the documents' text
// appended; what is stored as the person's message stays what they typed.
import type { PersonRow } from "@/lib/memoryIngestion";
import { checkAttachmentCapacity, createAttachment } from "@/lib/attachments";
import { extractDocument } from "@/lib/documentExtraction";
import { insertProvisionalTurn } from "@/lib/conversationHistory";
import { DocumentAttachmentError, type DocumentTurnAttachment, type Surface } from "@/lib/turnShared";

interface ReadDocument {
  item: DocumentTurnAttachment;
  bytes: Uint8Array;
  body: string;
}

export async function attachDocuments(actor: PersonRow, surface: Surface, conversationId: string, turnId: string, text: string, documents: readonly DocumentTurnAttachment[], temporary: boolean): Promise<string> {
  if (documents.length === 0) return text;
  if (temporary) throw new DocumentAttachmentError("Documents cannot be attached in a temporary chat");
  const read: ReadDocument[] = [];
  for (const item of documents) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(item.data);
    if (!match || match[1]!.toLowerCase() !== item.mediaType.toLowerCase()) throw new DocumentAttachmentError("Document attachment is invalid");
    const bytes = new Uint8Array(Buffer.from(match[2]!, "base64"));
    const capacity = checkAttachmentCapacity(actor, item.mediaType, bytes);
    if (!capacity.ok) throw new DocumentAttachmentError(capacity.error);
    const result = await extractDocument(bytes, item.mediaType);
    if (!result.ok) throw new DocumentAttachmentError(result.error);
    const body = result.value.pages.map((page) => page.text).join("\n\n").trim();
    if (!body) throw new DocumentAttachmentError("Document has no readable text");
    read.push({ item, bytes, body });
  }
  insertProvisionalTurn(actor, surface, conversationId, turnId, text);
  const extracted: string[] = [];
  for (const { item, bytes, body } of read) {
    const saved = createAttachment(actor, { conversationId, turnId, mediaType: item.mediaType, bytes });
    if (!saved.ok) throw new DocumentAttachmentError(saved.error);
    extracted.push(`<document name="${item.name.replace(/[<>\r\n]/g, " ")}">\n${body}\n</document>`);
  }
  return `${text}\n\n${extracted.join("\n\n")}`;
}
