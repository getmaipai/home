import { loraAllowsSuggesting } from "@maipai/spec/records/ts/validate.js";
import { loraUsable, readLoras } from "@/lib/loras/access";
import { MAX_STYLES } from "@/lib/loras/promptPlan";
import type { AdultProof } from "@/lib/adultLock";
import type { PersonRow } from "@/types";
import type { Lora } from "./store";

const words = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 3));

function score(textWords: Set<string>, lora: Lora): number {
  const name = words(lora.name);
  const triggers = new Set(lora.trigger_words.flatMap((word) => [...words(word)]));
  const description = words(lora.description);
  let total = 0;
  for (const word of textWords) total += (name.has(word) ? 2 : 0) + (triggers.has(word) ? 2 : 0) + (description.has(word) ? 1 : 0);
  return total;
}

/** Local prompt matching over the records this person may already read on this surface. */
export function suggestStyles(input: { person: PersonRow; media: "picture" | "video"; text: string; surface?: "own_written" | "shared" | "spoken"; proof?: AdultProof }): { items: Lora[] } {
  const textWords = words(input.text);
  if (textWords.size === 0) return { items: [] };
  const candidates = readLoras(input.person, input.surface ?? "own_written", { media: input.media, proof: input.proof }).items
    .filter((lora) => loraUsable(lora) && loraAllowsSuggesting(lora))
    .map((lora) => ({ lora, score: score(textWords, lora) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.lora.name.localeCompare(b.lora.name) || a.lora.id.localeCompare(b.lora.id));
  const items: Lora[] = [];
  let character = false;
  for (const { lora } of candidates) {
    if (lora.kind === "character" && character) continue;
    items.push(lora);
    if (lora.kind === "character") character = true;
    if (items.length >= MAX_STYLES) break;
  }
  return { items };
}
