import type { z } from "zod";
import type { PersonRow } from "@/types";
export type MediaKind = "picture" | "video" | "audio";
export interface MediaRef { kind: MediaKind; via: "chat" | "file"; id: string; conversationId?: string }
export type MediaControl = { kind: "mask"; name: string; label: string } | { kind: "number"; name: string; label: string; min?: number; max?: number } | { kind: "choice"; name: string; label: string; options: readonly string[] } | { kind: "words"; name: string; label: string };
/** MAKE-CLEARER-01: one named level of an operation (Quick, Better, Best): the one-line description and time estimate people see. The registry adds whether each is ready. */
export interface MediaLevel { id: string; label: string; summary: string; eta: string }
export interface MediaOp<Args extends z.ZodType = z.ZodType> { id: `${string}.${string}`; label: string; summary: string; input: MediaKind; output: MediaKind | "data"; args: Args; controls: readonly MediaControl[]; needs: string | "image" | "video" | null; minBand: "child" | "teen" | "adult"; levels?: readonly MediaLevel[]; listed?: boolean; audienceOverride?: boolean; run(ctx: { actor: PersonRow; signal?: AbortSignal }, input: { source: MediaRef; args: z.infer<Args> }): Promise<any> }
