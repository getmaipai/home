import { and, eq } from "drizzle-orm";
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { attachments, conversationTurns } from "@/db/schema";
import { db } from "@/db";
import { newFileId } from "@/lib/id";
import { insertProvisionalTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { createAttachment, readAttachmentForConversation, storeTemporaryChatImage, getTemporaryChatImage, getTemporaryChatImageForReader, temporaryChatImagesForTurn } from "@/lib/attachments";
import { getPersonSettingValue, getPersonSettingSource } from "@/lib/settings";
import { speakerAgeBand } from "@/lib/ageBand";
import { redactCredentials } from "@/lib/memoryContentPolicy";
import { cleanChatImage, chatImageThumbnail } from "@/lib/imageUpload";
import { MAX_CHAT_IMAGES, MAX_CHAT_IMAGE_BYTES, CHAT_IMAGE_REFUSAL } from "@/wire";

export const attachmentsRoutes = apiRouter();
const uploadRoute = createRoute({
  method: "post", path: "/upload", tags: ["Attachments"], summary: "Store one cleaned chat picture locally",
  middleware: [requireAuth] as const,
  request: { body: { content: { "multipart/form-data": { schema: z.object({ file: z.any(), conversation_id: z.string().optional(), turn_id: z.string(), temporary: z.string().optional() }) } } } },
  responses: { 201: { content: { "application/json": { schema: z.object({ conversation_id: z.string(), turn_id: z.string(), image: z.object({ id: z.string(), name: z.string(), width: z.number(), height: z.number(), media_type: z.string() }) }) } }, description: "Stored cleaned image." }, ...errorResponses({ 400: "Invalid image", 403: "Photo uploads disabled or storage cap reached", 404: "Conversation unavailable" }) },
});
attachmentsRoutes.openapi(uploadRoute, async (c) => {
  const actor = c.get("person");
  const form = await c.req.parseBody();
  const file = form.file;
  const turnId = String(form.turn_id ?? "");
  if (!(file instanceof File) || !/^turn-[a-z0-9]{8,40}$/.test(turnId)) return c.json({ error: "Invalid image upload." }, 400);
  const band = speakerAgeBand(actor, new Date());
  const settingOn = getPersonSettingValue(actor, "chat.photo_uploads") === true;
  const explicitlySet = Boolean(getPersonSettingSource(actor.id, "chat.photo_uploads"));
  if (!settingOn || (band === "child" && !explicitlySet)) return c.json({ error: "Photo uploads are turned off for this profile." }, 403);
  if (file.size > MAX_CHAT_IMAGE_BYTES) return c.json({ error: CHAT_IMAGE_REFUSAL }, 400);
  const temporary = form.temporary === "true";
  const resolved = resolveOrCreateConversation(actor, "chat", String(form.conversation_id || "") || undefined, { temporary });
  if (!resolved.ok) return c.json({ error: resolved.error }, 404);
  const conversationId = resolved.value.id;
  const priorCount = temporary
    ? temporaryChatImagesForTurn(actor, conversationId, turnId).length
    : db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.turnId, turnId), eq(attachments.conversationId, conversationId))).all().length;
  if (priorCount >= MAX_CHAT_IMAGES) return c.json({ error: CHAT_IMAGE_REFUSAL }, 400);
  try {
    const cleaned = await cleanChatImage(new Uint8Array(await file.arrayBuffer()));
    const name = redactCredentials(file.name.replace(/[\r\n\0]/g, "").slice(0, 255)).trim() || "picture.jpg";
    let id: string;
    if (temporary) {
      id = newFileId();
      storeTemporaryChatImage({ id, turnId, conversationId, ownerPersonId: actor.id, name, mediaType: cleaned.mediaType, width: cleaned.width, height: cleaned.height, bytes: cleaned.bytes });
    } else {
      const existingTurn = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
      if (!existingTurn) insertProvisionalTurn(actor, "chat", conversationId, turnId, "");
      else if (existingTurn.personId !== actor.id || existingTurn.conversationId !== conversationId || existingTurn.status !== "running") return c.json({ error: "Turn unavailable." }, 404);
      const created = createAttachment(actor, { conversationId, turnId, mediaType: cleaned.mediaType, bytes: cleaned.bytes, provenance: `composer:${name}`, deduplicate: false });
      if (!created.ok) return c.json({ error: created.error }, created.status === 403 ? 403 : 400);
      id = created.value.id;
    }
    return c.json({ conversation_id: conversationId, turn_id: turnId, image: { id, name, width: cleaned.width, height: cleaned.height, media_type: cleaned.mediaType } }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Could not process this picture." }, 400);
  }
});

const imageRoute = createRoute({
  method: "get", path: "/{id}", tags: ["Attachments"], summary: "Read a cleaned chat picture",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "file-a1b2c3"), query: z.object({ v: z.enum(["thumb", "full"]) , conversation_id: z.string().optional() }) },
  responses: { 200: { content: { "image/jpeg": { schema: z.string() } }, description: "Cleaned local picture." }, ...errorResponses({ 401: "Not signed in", 404: "Picture unavailable" }) },
});
attachmentsRoutes.openapi(imageRoute, async (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const { v, conversation_id: conversationId } = c.req.valid("query");
  if (conversationId) {
    const temp = getTemporaryChatImageForReader(actor, conversationId, id);
    if (temp) {
      const bytes = v === "thumb" ? await chatImageThumbnail(temp.bytes) : temp.bytes;
      return new Response(bytes, { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
  }
  const found = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!found || found.mediaType !== "image/jpeg" || !found.conversationId) return c.json({ error: "Picture unavailable." }, 404);
  if (conversationId && conversationId !== found.conversationId) return c.json({ error: "Picture unavailable." }, 404);
  const result = readAttachmentForConversation(actor, found.conversationId, id);
  if (!result.ok) return c.json({ error: "Picture unavailable." }, 404);
  const bytes = v === "thumb" ? await chatImageThumbnail(result.value.bytes) : result.value.bytes;
  return new Response(bytes, { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
});
