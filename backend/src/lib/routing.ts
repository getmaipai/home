// Routing no longer embeds package examples or compares semantic scores.
// The utterance vector remains shared with memory recall so a turn pays
// for at most one embedding request.
import { embed } from "@/lib/llm";

// FAST-04: tests prove a literal-pattern turn never embeds and an
// ordinary one embeds exactly once for recall.
let __embedCallCount = 0;

export interface UtteranceVector {
  vector: Float32Array;
  space: string;
  dims: number;
  preprocess: string;
}

export async function embedUtterance(text: string): Promise<UtteranceVector | undefined> {
  __embedCallCount++;
  try {
    const result = await embed([text]);
    if (!result.ok) return undefined;
    const vector = result.value.vectors[0]!;
    return { vector: new Float32Array(vector), space: result.value.model, dims: vector.length, preprocess: result.value.preprocess };
  } catch {
    return undefined;
  }
}

export function __embedCallCountForTests(): number {
  return __embedCallCount;
}

export function __resetEmbedCallCountForTests(): void {
  __embedCallCount = 0;
}

export { utteranceShape, conversationShaped, commandOpenersFrom, type UtteranceShape } from "@/lib/utteranceShape";
