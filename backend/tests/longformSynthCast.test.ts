import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { owner } from "./support/testAuth";
import { createSynth } from "@/lib/synths";
import { listMediaSubjects } from "@/lib/mediaSubjects";
import { prepareCharacters, savedCharacters } from "@/lib/longform/characters";

const persona = { display_name: "Moss", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "all" } as const;
let actor: Awaited<ReturnType<typeof owner>>["row"];

beforeEach(async () => { resetDb(); actor = (await owner()).row; });

describe("synths as characters of a production", () => {
  test("naming one of my synths makes it a saved character with its look", async () => {
    const made = await createSynth(actor, { persona, based_on: { kind: "none", person_id: null, name: null, refresh: "7d", minor: false }, life: { enabled: false, seed: "" } });
    if (!made.ok) throw new Error("The test synth could not be created.");
    const result = await prepareCharacters(actor, { names: ["moss"], images: [] });
    expect(result).toEqual({ ok: true, names: ["Moss"] });
    expect(listMediaSubjects(actor).some((s) => s.name === "Moss")).toBe(true);
    expect(savedCharacters(actor, ["Moss"]).length).toBe(1);
  });
  test("a name that is neither a synth nor a saved character asks for a picture", async () => {
    const result = await prepareCharacters(actor, { names: ["Nobody"], images: [] });
    expect(result.ok).toBe(false);
  });
});
