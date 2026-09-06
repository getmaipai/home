import { api, readTurnStream } from "@/lib/api";
import { stripThinking } from "@/apps/chat/chatModelAdapter";

/** Runs one fixed utterance through the real turn route and returns only
 * the final reply text (step 6's weather card: "calling the weather
 * plugin through the existing turn route with a fixed utterance, cached
 * by the query layer" - no separate widget backend, the same route Chat
 * itself uses). Ignores `turn_meta`/`delta`/`spoken_cue` entirely: a home
 * card shows the finished answer, not a live-typing effect, speech, or the
 * contract's own turn/conversation id line. */
export async function runFixedTurn(text: string): Promise<string> {
  const response = await api.streamTurn(text);
  for await (const event of readTurnStream(response)) {
    if (event.type === "done") return stripThinking(event.value.reply.text);
    if (event.type === "turn_meta" || event.type === "delta" || event.type === "spoken_cue") continue;
    throw new Error(event.error || "Something went wrong.");
  }
  throw new Error("The connection ended before MaiPai finished replying.");
}
