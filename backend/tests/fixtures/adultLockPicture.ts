// ADULT-LOCK-07 slice 1: stored picture fixtures use the same writer notes as
// pictures/jobs.ts and imageEdit.ts, through createAttachment's file path.
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { createAttachment } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { testPng } from "../pictureFixture";
import type { PersonRow } from "@/types";

let sequence = 0;

export async function makePicture(actor: PersonRow, audience: "adult-only" | "all-ages", label: string) {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const turnId = newConversationTurnId();
  const now = new Date().toISOString();
  db.insert(conversationTurns).values({ id: turnId, personId: actor.id, surface: "chat", conversationId: conversation.value.id,
    userText: label, replyText: "saved", source: "model", safetyAction: "allow", createdAt: now, hlc: nextHlc() }).run();
  const job = `picture-fixture-${++sequence}`;
  const created = createAttachment(actor, { conversationId: conversation.value.id, turnId, mediaType: "image/jpeg", bytes: await testPng(), deduplicate: false,
    provenance: `picture-gen:${JSON.stringify({ v: 1, audience, job, index: 0, prompt: label, width: 1, height: 1 })}` });
  if (!created.ok) throw new Error(created.error);
  return { id: created.value.id, conversationId: conversation.value.id, turnId, label, sha256: created.value.sha256 };
}

export async function makeImageEdit(actor: PersonRow, source: Awaited<ReturnType<typeof makePicture>>, label: string) {
  const created = createAttachment(actor, { conversationId: source.conversationId, turnId: source.turnId, mediaType: "image/png", bytes: await testPng(), deduplicate: false,
    provenance: `image-edit:${JSON.stringify({ v: 1, audience: "adult-only", op: "resize", label, source: source.id, source_sha256: source.sha256, root: source.id, width: 1, height: 1 })}` });
  if (!created.ok) throw new Error(created.error);
  return { id: created.value.id, label };
}
