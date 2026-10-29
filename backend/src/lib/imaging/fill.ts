import { clippedEdges } from "./subject";
import { fillCutOffInstruction } from "./instructions";

/**
 * What to draw in for a picture the frame cut off. `stored` is the edge list measured before the picture was fitted into
 * its frame; a fitted picture no longer touches its edges, so a stored list wins over measuring the bytes again.
 * Returns null when nothing is cut off.
 */
export async function planFillCutOff(bytes: Uint8Array, stored?: readonly string[]): Promise<{ edges: string[]; instruction: string } | null> {
  const edges = stored?.length ? [...stored] : Object.entries(await clippedEdges(bytes)).filter(([, cut]) => cut).map(([edge]) => edge);
  return edges.length ? { edges, instruction: fillCutOffInstruction(edges) } : null;
}
