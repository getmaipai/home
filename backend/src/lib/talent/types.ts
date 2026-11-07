import { z } from "zod";
import type { Persona } from "@/lib/persona";
import type { AgeBand } from "@/lib/ageBand";
import type { Production } from "@/lib/mediaProductions";
import type { ShowFormat } from "@maipai/spec/gen/ts/show-format.js";

export type Part = "anchor" | "reporter" | "host" | "co_host" | "guest" | "moderator" | "side" | "critic" | "dj" | "narrator" | "announcer" | "actor";
export interface CastMember { synth_id: string; part: Part; display_name: string; persona: Persona; voice: string; minor: boolean; absent: null | { text: string; back: string | null } }
export interface Brief {
  show: Production; format: ShowFormat; cast: CastMember[]; audience: AgeBand; date: string; weekday: string; air_time: string;
  stories: Array<{ id: string; title: string; summary: string; points: string[]; publisher: string; published_at: string | null; topic: string | null }>;
  weather: string | null; household: string[]; documents: Array<{ title: string; text: string }>; item: { title: string; kind: string; description: string } | null;
  cards: Record<string, string>; beats: Record<string, Array<{ at: string; text: string }>>; recaps: Array<{ at: string; text: string }>; person_name: string | null;
}
export const OutlineSchema = z.object({ title: z.string().max(90), segments: z.array(z.object({ kind: z.enum(["hook", "intro", "segment", "exchange", "closing"]), goal: z.string().max(200), source_refs: z.array(z.string()).max(6), seconds: z.number().int().min(8).max(600), leads: z.string(), beats_to_use: z.array(z.string()).max(3) })).min(2).max(24) });
export const LineSchema = z.object({ part: z.string(), text: z.string().min(1).max(600), delivery: z.object({ energy: z.enum(["low", "mid", "high"]), pace: z.enum(["slow", "mid", "quick"]), tags: z.array(z.string().max(16)).max(2) }), timing: z.object({ gap_ms: z.number().int().min(0).max(2000).nullable(), overlap_ms: z.number().int().min(0).max(900).nullable(), cut_in_at_word: z.number().int().min(1).nullable(), talked_over: z.enum(["yield", "continue"]).nullable(), backchannels: z.array(z.object({ part: z.string(), word_index: z.number().int().min(1), text: z.string().max(24) })).max(2) }) });
export const SegmentScriptSchema = z.object({ lines: z.array(LineSchema).min(1).max(60) });
export type Outline = z.infer<typeof OutlineSchema>; export type Line = z.infer<typeof LineSchema>;
export interface Script { title: string; segments: Array<{ kind: string; goal: string; lines: Line[] }> }
