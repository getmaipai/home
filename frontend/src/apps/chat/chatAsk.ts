// FORM-CHAT-WEB-01: the web half of a typed package ask (docs/design/form-in-chat-2026-10-25.md,
// docs/dev/form-in-chat-wire.md). `TurnValue.ask` is drawn as a `ToolCallMessagePart` named "ask"
// (elementBindings.ts) and its Submit goes out as `ask_answer { turn_id, values }`.
//
// RULES.md rule 6a: the prompt and the submitted values live only in the form's own state, the
// in-memory arm below and the request body. Nothing here logs, traces or stores them.
import type { TurnAsk, TurnAskField } from "@maipai/home-backend/src/wire";

/** The `text` a form Submit sends: the hub ignores a form submission's text and writes its own fixed line,
 * so the person's typing is never part of the request. */
export const ASK_FORM_SUBMIT_TEXT = "I filled in the form.";

export type AskFormValues = Record<string, string | number | boolean | null>;

/** What a form Submit learns about its own send: it started (the reply streams as a new turn) or the hub refused it. */
export type AskSettled = { ok: true } | { ok: false; code: string; message: string };

/** The one-shot answer armed before a card sends: a confirm tap, or a typed form's values. */
export type AskAnswerArm =
  | { turnId: string; approved: boolean }
  | { turnId: string; values: AskFormValues; onSettled?: (outcome: AskSettled) => void };

export function isFormAnswer(arm: AskAnswerArm): arm is Extract<AskAnswerArm, { values: AskFormValues }> {
  return "values" in arm;
}

const FIELD_KINDS = new Set(["text", "number", "date_time", "choice", "yes_no"]);
const MAX_FIELDS = 4;

function validField(raw: unknown): raw is TurnAskField {
  if (!raw || typeof raw !== "object") return false;
  const f = raw as Record<string, unknown>;
  if (typeof f.name !== "string" || !f.name || typeof f.label !== "string" || !f.label) return false;
  if (typeof f.kind !== "string" || !FIELD_KINDS.has(f.kind) || typeof f.required !== "boolean") return false;
  if (f.placeholder !== undefined && typeof f.placeholder !== "string") return false;
  if (f.min !== undefined && (typeof f.min !== "number" || !Number.isFinite(f.min))) return false;
  if (f.max !== undefined && (typeof f.max !== "number" || !Number.isFinite(f.max))) return false;
  if (f.max_length !== undefined && f.max_length !== 500) return false;
  if (f.options !== undefined && (!Array.isArray(f.options) || !f.options.every((o) => typeof o === "string" && o))) return false;
  if (f.kind === "choice" && (!Array.isArray(f.options) || f.options.length < 2)) return false;
  return true;
}

/** The ask as the form can draw it, or null for anything unknown or malformed (the reply's text stands in). */
export function parseTurnAsk(raw: unknown): TurnAsk | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.turn_id !== "string" || !a.turn_id || typeof a.prompt !== "string" || !a.prompt) return null;
  if (typeof a.expires_at !== "string" || Number.isNaN(Date.parse(a.expires_at))) return null;
  if (!Array.isArray(a.fields) || a.fields.length === 0 || a.fields.length > MAX_FIELDS || !a.fields.every(validField)) return null;
  const names = new Set(a.fields.map((f: TurnAskField) => f.name));
  if (names.size !== a.fields.length) return null;
  return a as unknown as TurnAsk;
}

/** The `ask` tool part's result: the validated ask, nothing else. */
