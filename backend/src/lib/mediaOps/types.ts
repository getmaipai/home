import type { z } from "zod";
import type { PersonRow } from "@/types";
export type MediaKind = "picture" | "video" | "audio";
export interface MediaRef { kind: MediaKind; via: "chat" | "file"; id: string; conversationId?: string }
export type MediaControl = { kind: "mask"; name: string; label: string } | { kind: "number"; name: string; label: string; min?: number; max?: number } | { kind: "choice"; name: string; label: string; options: readonly string[] } | { kind: "words"; name: string; label: string };
export interface MediaOp<Args extends z.ZodType = z.ZodType> { id: `${string}.${string}`; label: string; summary: string; input: MediaKind; output: MediaKind; args: Args; controls: readonly MediaControl[]; needs: string | "image" | "video" | null; minBand: "child" | "teen" | "adult"; run(ctx: { actor: PersonRow; signal?: AbortSignal }, input: { source: MediaRef; args: z.infer<Args> }): Promise<{ file: unknown } | { job: unknown }> }
