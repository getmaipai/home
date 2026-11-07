// MUSIC-STUDIO-STYLE: `make_song_style`, a saved song style made in chat, and the actions of its card (save, discard, edit). A song
// style is words only (never lyrics): a sound a person can make songs in. The model writes the fields; this saves them as the
// person's own style, which the Music app lists under Styles. Rule 6a: nothing here logs a title or the style words.
import { outcomeOf } from "@/lib/turnContext";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import type { PersonRow } from "@/types";
import { blockEnvelope } from "@/lib/packageBlocks";
import type { BandState } from "./band";
import { createMade, deleteMade, getMade, updateMade } from "./madeRecords";
import { musicDenial } from "./policy";
import type { SoundStyle } from "./sound";
import { musicAudienceOf } from "./tool";
import type { Result } from "@/lib/result";

export const MAKE_SONG_STYLE_TOOL_ID = "make_song_style";
export const EDIT_SONG_STYLE_TOOL_ID = "edit_song_style";

export const STYLE_NOT_HERE_LINE = "No song style was saved. Tell the person song styles are not available on this screen or for this person.";
export const STYLE_BAD_LINE = "No song style was saved, because the words were not allowed or not valid. Tell the person, and offer to try different words.";

type StyleRecord = { id: string; title: string; style: SoundStyle; origin?: string; owner_person_id?: string | null };

/** `make_song_style:<style id>:<conversation id>:<turn id>`. */
export const styleProvenance = (styleId: string, where: { conversationId: string | null; turnId: string | null }): string => `make_song_style:${styleId}:${where.conversationId ?? "-"}:${where.turnId ?? "-"}`;
const STYLE_ACTIONS = ["make_song", "save", "discard"] as const;

export function styleBlock(rec: StyleRecord, where: { conversationId: string | null; turnId: string | null }): Record<string, unknown> {
  const s = rec.style;
  const props: Record<string, unknown> = { title: rec.title, sound: s.description, genres: s.genres ?? [], editable: rec.origin !== "starter", actions: [...STYLE_ACTIONS] };
  if (s.instrumental) props.instrumental = true;
  if (s.bpm != null) props.bpm = s.bpm;
  if (s.key) props.key = s.key;
  if (s.length_s != null) props.length_s = s.length_s;
  return blockEnvelope("song_style", MAKE_SONG_STYLE_TOOL_ID, `The song style ${rec.title}.`, styleProvenance(rec.id, where), props);
}

export interface StylePatchInput { title?: string; sound?: string; genres?: string[]; instrumental?: boolean; bpm?: number | null; key?: string | null; length_s?: number | null }

/** The record fields a style edit changes: the title is the record's own, everything else lives in its one style. */
export function styleFieldsFromPatch(rec: StyleRecord, patch: StylePatchInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (typeof patch.title === "string") fields.title = patch.title.trim();
  const style: Record<string, unknown> = { ...rec.style };
  let touched = false;
  const put = (key: string, value: unknown) => { style[key] = value; touched = true; };
  if (typeof patch.sound === "string") put("description", patch.sound.trim());
  if (Array.isArray(patch.genres)) put("genres", patch.genres.slice(0, 8));
  if (typeof patch.instrumental === "boolean") put("instrumental", patch.instrumental);
  if (patch.bpm !== undefined) put("bpm", patch.bpm);
  if (patch.key !== undefined) put("key", patch.key);
  if (patch.length_s !== undefined) put("length_s", patch.length_s);
  if (touched) fields.style = style;
  return fields;
}

export type StyleActionName = "save" | "discard" | "edit" | "make_song";
export const STYLE_ACTION_NAMES = ["save", "discard", "edit", "make_song"] as const;
export type StyleActionResult = Result<{ action: StyleActionName; done: string; style?: Record<string, unknown> }, 400 | 403 | 404>;

export function runStyleAction(actor: PersonRow, styleId: string, action: StyleActionName, opts: { patch?: StylePatchInput; conversationId?: string | null; turnId?: string | null } = {}): StyleActionResult {
  const found = getMade("song_style", actor, styleId);
  if (!found.ok) return { ok: false, status: 404, error: "That song style is not here any more. It may have been discarded." };
  const rec = found.value as unknown as StyleRecord;
  const where = { conversationId: opts.conversationId ?? null, turnId: opts.turnId ?? null };
  if (action === "save" || action === "make_song") return { ok: true, value: { action, style: styleBlock(rec, where), done: "Saved. The style is in Music under Styles." } };
  if (rec.owner_person_id !== actor.id) return { ok: false, status: 403, error: rec.origin === "starter" ? "A starter style cannot be changed. Make your own style from it." : "Only the person who made the style can do that. Ask them." };
  if (action === "discard") {
    const gone = deleteMade("song_style", actor, styleId);
    return gone.ok ? { ok: true, value: { action, done: "Discarded. The style is gone." } } : { ok: false, status: gone.status as 403 | 404, error: gone.error };
  }
  const fields = styleFieldsFromPatch(rec, opts.patch ?? {});
  if (Object.keys(fields).length === 0) return { ok: false, status: 400, error: "There was nothing to change. Tell me what to change about the style." };
  const saved = updateMade("song_style", actor, styleId, fields);
  return saved.ok ? { ok: true, value: { action, style: styleBlock(saved.value as unknown as StyleRecord, where), done: "Changed. The earlier version is kept." } } : { ok: false, status: saved.status, error: saved.error };
}

/** The turn's runner for `make_song_style`: the model wrote the fields; they are saved as the person's own style. */
export function runMakeSongStyle(input: { state: BandState; args: Record<string, unknown>; callId: string; spoken: boolean }): ToolExecutionOutcome {
  const { state, args, callId } = input;
  const actor = state.actor as PersonRow;
  const done = (text: string, extra: Record<string, unknown> = {}) => outcomeOf({ callId, packageId: MAKE_SONG_STYLE_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text }, ...extra, actions: [] } as NonNullable<ToolExecutionOutcome["result"]> });
  if (musicDenial(musicAudienceOf(state, input.spoken))) return done(STYLE_NOT_HERE_LINE);
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);
  const style: Record<string, unknown> = { description: str(args.sound, 1000), genres: Array.isArray(args.genres) ? [...new Set(args.genres.map((g) => str(g, 40)).filter(Boolean))].slice(0, 8) : [] };
  if (typeof args.instrumental === "boolean") style.instrumental = args.instrumental;
  if (num(args.bpm) !== undefined) style.bpm = num(args.bpm);
  if (str(args.key, 20)) style.key = str(args.key, 20);
  if (num(args.length_s) !== undefined) style.length_s = num(args.length_s);
  const title = str(args.title, 120);
  if (!title || !style.description) return done(STYLE_BAD_LINE);
  const made = createMade("song_style", actor, { title, style, seed: null });
  if (!made.ok) return done(STYLE_BAD_LINE);
  const rec = made.value as unknown as StyleRecord;
  return done("The song style is saved in Music under Styles. Offer to make a song in it, naming the style.", { data: { styleId: rec.id }, blocks: [styleBlock(rec, state)] });
}
