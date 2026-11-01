import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { selectedSpeakerFromCache } from "@/apps/chat/selectedSpeaker";

const card = (id: string, name: string, portrait?: string) => ({ id, name, ...(portrait ? { portrait } : {}) });
function client(opts: { conversationCompanion?: string; active?: string } = {}) {
  const qc = new QueryClient();
  qc.setQueryData(["companions"], { default_id: "sage", companions: [card("sage", "Sage"), card("rivet", "Rivet", "rivet/look1"), card("bruno", "Bruno")] });
  qc.setQueryData(["settingsValues", "person:p1"], opts.active ? [{ key: "persona.active_id", value: opts.active }] : []);
  if (opts.conversationCompanion) qc.setQueryData(["conversation", "c1"], { id: "c1", companion_id: opts.conversationCompanion });
  return qc;
}

describe("selectedSpeakerFromCache", () => {
  test("the conversation's own companion wins, with its portrait key", () => {
    expect(selectedSpeakerFromCache(client({ conversationCompanion: "rivet", active: "bruno" }), "p1", "c1", undefined)).toEqual({ companion_id: "rivet", name: "Rivet", look: null, via: "conversation", portrait: "rivet/look1" });
  });
  test("a new chat uses the person's active companion, then the household default", () => {
    expect(selectedSpeakerFromCache(client({ active: "bruno" }), "p1", undefined, undefined)?.companion_id).toBe("bruno");
    expect(selectedSpeakerFromCache(client(), "p1", undefined, undefined)?.companion_id).toBe("sage");
  });
  test("a draft being tried wins over everything", () => {
    expect(selectedSpeakerFromCache(client({ conversationCompanion: "rivet" }), "p1", "c1", "bruno")?.companion_id).toBe("bruno");
  });
  test("nothing is made up before the companion list has loaded", () => {
    expect(selectedSpeakerFromCache(new QueryClient(), "p1", undefined, undefined)).toBeUndefined();
  });
});
