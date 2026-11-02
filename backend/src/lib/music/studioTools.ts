// MUSIC-STUDIO-EDIT: the five creation and edit tools of Music Studio that run inside the hub (make_album, make_song_style and the three
// edit_* tools). The policy node has already checked the offer and, for an edit, replaced any id the model wrote with the one object
// the turn follows (a message reference or the card in the thread), so a forged id never reaches here. An edit is a revision with
// provenance (updateMade keeps the version it replaces); it never overwrites silently. Rule 6a: nothing here logs a name, a title or an id.
import { outcomeOf } from "@/lib/turnContext";
import type { ToolExecutionOutcome, TurnState } from "@/lib/turnMachine/contract";
import type { PersonRow } from "@/types";
import { EDIT_ALBUM_TOOL_ID, MAKE_ALBUM_TOOL_ID, runAlbumAction, runMakeAlbum } from "./album";
import { runBandAction, type BandPatchInput } from "./bandActions";
import { EDIT_SONG_STYLE_TOOL_ID, MAKE_SONG_STYLE_TOOL_ID, runMakeSongStyle, runStyleAction, type StylePatchInput } from "./styleCard";
import type { BandState } from "./band";

export const EDIT_BAND_TOOL_ID = "edit_band";
export const STUDIO_TOOL_IDS = [MAKE_ALBUM_TOOL_ID, MAKE_SONG_STYLE_TOOL_ID, EDIT_BAND_TOOL_ID, EDIT_ALBUM_TOOL_ID, EDIT_SONG_STYLE_TOOL_ID] as const;
export type StudioToolId = (typeof STUDIO_TOOL_IDS)[number];
export const isStudioTool = (tool: string): tool is StudioToolId => (STUDIO_TOOL_IDS as readonly string[]).includes(tool);

/** The object kind each edit tool follows. */
export const EDIT_TOOL_OBJECT: Record<string, "band" | "album" | "style"> = { [EDIT_BAND_TOOL_ID]: "band", [EDIT_ALBUM_TOOL_ID]: "album", [EDIT_SONG_STYLE_TOOL_ID]: "style" };

const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const words = (v: unknown): string[] | undefined => (Array.isArray(v) ? [...new Set(v.map((g) => text(g, 40)).filter((g): g is string => Boolean(g)))].slice(0, 8) : undefined);
const whole = (v: unknown): number | null | undefined => (v === null ? null : typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);
const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const reply = (callId: string, packageId: string, args: Record<string, unknown>, line: string, extra: Record<string, unknown> = {}): ToolExecutionOutcome =>
  outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: line }, ...extra, actions: [] } as NonNullable<ToolExecutionOutcome["result"]> });

/** The card as this tool's own block: the producer must be the package that returned it. */
const asBlock = (block: Record<string, unknown> | undefined, producer: string): Record<string, unknown>[] => (block ? [{ ...block, producer }] : []);

export async function runStudioTool(tool: StudioToolId, input: { state: BandState & Pick<TurnState, "musicObject">; args: Record<string, unknown>; callId: string; spoken: boolean }): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const actor = state.actor as PersonRow;
  const where = { conversationId: state.conversationId ?? null, turnId: state.turnId ?? null };
  const id = state.musicObject?.id ?? "";
  if (tool === MAKE_ALBUM_TOOL_ID) {
    const outcome = await runMakeAlbum({ ...input, args: { ...args, ...(state.musicObject?.kind === "band" && state.musicObject.id ? { band: state.musicObject.id } : {}), ...(state.musicObject?.kind === "style" && state.musicObject.id ? { song_style: state.musicObject.id } : {}) } });
    return outcome;
  }
  if (tool === MAKE_SONG_STYLE_TOOL_ID) return runMakeSongStyle(input);
  if (tool === EDIT_BAND_TOOL_ID) {
    const patch: BandPatchInput = drop({ name: text(args.name, 120), backstory: text(args.backstory, 4000), look: text(args.look, 1000), sound: text(args.sound, 1000), genres: words(args.genres) });
    const picture = args.new_portrait === true ? "remake_portrait" : args.new_logo === true ? "remake_logo" : null;
    const lines: string[] = []; let block: Record<string, unknown> | undefined;
    if (Object.keys(patch).length) {
      const r = await runBandAction(actor, id, "edit", where, patch);
      if (!r.ok) return reply(callId, tool, args, r.error);
      lines.push(r.value.done); block = r.value.band;
    }
    if (picture) {
      const r = await runBandAction(actor, id, picture, where);
      lines.push(r.ok ? r.value.done : r.error);
    }
    return reply(callId, tool, args, lines.join(" ") || "There was nothing to change. Ask the person what to change about the band.", { data: { bandId: id }, blocks: asBlock(block, tool) });
  }
  if (tool === EDIT_ALBUM_TOOL_ID) {
    const patch = drop({ title: text(args.title, 120), blurb: text(args.blurb, 1000), look: text(args.look, 1000), sound: text(args.sound, 1000), genres: words(args.genres),
      track_ids: Array.isArray(args.track_ids) ? args.track_ids.filter((t): t is string => typeof t === "string").slice(0, 100) : undefined });
    const lines: string[] = []; let block: Record<string, unknown> | undefined;
    if (Object.keys(patch).length) {
      const r = await runAlbumAction(actor, id, "edit", { patch, ...where });
      if (!r.ok) return reply(callId, tool, args, r.error);
      lines.push(r.value.done); block = r.value.album;
    }
    if (args.new_cover === true) {
      const r = await runAlbumAction(actor, id, "remake_cover", where);
      lines.push(r.ok ? r.value.done : r.error);
      if (r.ok && !block) block = r.value.album;
    }
    return reply(callId, tool, args, lines.join(" ") || "There was nothing to change. Ask the person what to change about the album.", { data: { albumId: id }, blocks: asBlock(block, tool) });
  }
  const patch: StylePatchInput = drop({ title: text(args.title, 120), sound: text(args.sound, 1000), genres: words(args.genres), instrumental: typeof args.instrumental === "boolean" ? args.instrumental : undefined,
    bpm: whole(args.bpm), key: args.key === null ? null : text(args.key, 20), length_s: whole(args.length_s) });
  const r = runStyleAction(actor, id, "edit", { patch, ...where });
  if (!r.ok) return reply(callId, tool, args, r.error);
  return reply(callId, tool, args, r.value.done, { data: { styleId: id }, blocks: asBlock(r.value.style, tool) });
}
