import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireRole } from "@/middleware/auth";
import { complete, embed, personWithinTurnBudget, type LlmMessage, type LlmRole } from "@/lib/llm";
import { evaluateSafety } from "@/lib/safety";
import { speakerAgeBand } from "@/lib/ageBand";
import { notifyIfFlagged } from "@/lib/notifications";
import type { AppEnv } from "@/types";

export const llmRoutes = new Hono<AppEnv>();

const RATE_LIMIT_RESPONSE = { error: "Too many requests too quickly.", code: "turn_rate_limited" } as const;

// Code review, 2026-09-06 (SEC-1): this route used to be open to any
// signed-in person with no safety check at all - a second, unfiltered
// front door to the model that bypassed the turn engine's non-removable
// child-safety layer entirely (evaluateSafety() ran nowhere on this
// path). Now that turnEngine.ts's runTurn/runTurnStream are the real,
// complete household chat surface, this route is downgraded to exactly
// what its own history always said it was heading toward: an
// owner/admin diagnostics tool, not a second way for a household member
// to talk to the model. A child or teen (or a non-owner adult profile)
// can no longer reach it at all.
//
// Even gated to owner/admin, the hard safety floor (CSAM, grooming,
// credible threats, prompt injection, and the rest of spec/safety's
// FLOOR - see lib/contentCeiling.ts) is never configurable off for
// ANY role, so evaluateSafety() still runs here on both the request and
// the reply, exactly like runTurn()/runTurnStream() do - checked against
// every message's content regardless of role, not just "user" ones (a
// review, 2026-09-06, found the first version of this route only scanned
// role: "user" content, so a floor-category message sent as role:
// "system" or "assistant" reached complete() completely unchecked). This
// route doesn't belong to a conversation (no conversation_id, no
// conversation_turns row), so unlike a real turn it doesn't attach
// crisis-resource text or log to history. notify_parent still fires the
// same way regardless: speakerAgeBand() reads the actor's own birthdate
// when one is on file, so an owner/admin profile whose birthdate reflects
// a minor age band still notifies, even though the ordinary case (an
// adult-banded owner/admin) never will - this is defense-in-depth
// consistency with runTurn(), not a claim that it can identify who is
// physically typing.
const MAX_CHAT_MESSAGES = 64;
const MAX_CHAT_MESSAGE_CHARS = 8_000;
const MAX_CHAT_TOKENS = 2_048;
const REFUSAL_TEXT = "I can't help with that.";

// A review, 2026-09-06, found this only capped a CALLER-SUPPLIED value -
// omitting max_tokens entirely skipped the cap altogether, passing
// `undefined` straight through to complete() (and whatever unbounded
// default that leaves llama-server to use). Always returns a real
// ceiling now.
export function clampMaxTokens(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) return MAX_CHAT_TOKENS;
  return Math.min(requested, MAX_CHAT_TOKENS);
}

/** Shared by /chat's messages[] and /embed's texts[] (a review, 2026-09-06,
 * found the count-cap-plus-per-item-length-cap shape copy-pasted between
 * them with different constant names): `null` means within bounds,
 * otherwise the exact error string+code pair the route should 400 with.
 * `texts` is already the plain strings to measure - each route extracts
 * its own item's text (a message's `.content`, or the text itself) before
 * calling this, since the two shapes otherwise have nothing in common. */
function boundsError(
  itemCount: number,
  maxCount: number,
  texts: readonly (string | undefined)[],
  maxChars: number,
  itemNoun: string,
): { error: string; code: "invalid_input" } | null {
  if (itemCount > maxCount) return { error: `${itemNoun} must be ${maxCount} or fewer`, code: "invalid_input" };
  if (texts.some((t) => typeof t === "string" && t.length > maxChars)) {
    return { error: `each entry in ${itemNoun} must be ${maxChars} characters or fewer`, code: "invalid_input" };
  }
  return null;
}

llmRoutes.post("/chat", requireRole("owner", "admin"), bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
  const actor = c.get("person");
  if (!personWithinTurnBudget(actor.id)) {
    return c.json(RATE_LIMIT_RESPONSE, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    role?: string;
    messages?: LlmMessage[];
    temperature?: number;
    max_tokens?: number;
  };
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const messagesBoundsError = boundsError(messages.length, MAX_CHAT_MESSAGES, messages.map((m) => m?.content), MAX_CHAT_MESSAGE_CHARS, "messages");
  if (messagesBoundsError) return c.json(messagesBoundsError, 400);
  const role = (body.role ?? "chat") as LlmRole;
  const band = speakerAgeBand(actor, new Date());
  // Every message's content, regardless of role - the floor categories
  // this exists to catch (CSAM, grooming, credible threats, prompt
  // injection) are exactly as real in a caller-supplied "system" or
  // "assistant" message as in a "user" one, and this route lets an
  // owner/admin caller set any of those roles.
  const requestText = messages
    .filter((m) => m && typeof m.content === "string")
    .map((m) => m.content)
    .join("\n");
  const inputSafety = evaluateSafety(requestText, band);
  notifyIfFlagged(actor, inputSafety, "[llm]");
  if (inputSafety.action === "refuse") {
    return c.json({ text: REFUSAL_TEXT, model: "safety_refuse" });
  }

  const result = await complete(role, messages, {
    temperature: body.temperature,
    max_tokens: clampMaxTokens(body.max_tokens),
  });
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  const outputSafety = evaluateSafety(result.value.text, band);
  notifyIfFlagged(actor, outputSafety, "[llm]");
  if (outputSafety.action === "refuse") {
    return c.json({ ...result.value, text: REFUSAL_TEXT });
  }
  return c.json(result.value);
});

const MAX_EMBED_TEXTS = 64;
const MAX_EMBED_TEXT_CHARS = 4_000;

// Same posture as /chat above (SEC-1): owner/admin diagnostics only, now
// that memory.ts's real vector recall is the household's actual embed
// caller. Caps texts.length and each text's length (SEC-5) - nothing
// downstream of embed() bounded either before this.
llmRoutes.post("/embed", requireRole("owner", "admin"), bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
  const actor = c.get("person");
  if (!personWithinTurnBudget(actor.id)) {
    return c.json(RATE_LIMIT_RESPONSE, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as { texts?: string[] };
  const texts = Array.isArray(body.texts) ? body.texts : [];
  const textsBoundsError = boundsError(texts.length, MAX_EMBED_TEXTS, texts, MAX_EMBED_TEXT_CHARS, "texts");
  if (textsBoundsError) return c.json(textsBoundsError, 400);
  const result = await embed(texts);
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, result.status);
  }
  return c.json(result.value);
});
