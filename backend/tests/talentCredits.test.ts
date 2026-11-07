import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { owner, child } from "./support/testAuth";
import { createSynth } from "@/lib/synths";

describe("TALENT-13 synth credits", () => {
  beforeEach(() => resetDb());

  test("a synth with no credits returns empty groups", async () => {
    const { client, row } = await owner();
    const made = await createSynth(row, { persona: { display_name: "Moss", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "all" } as never, based_on: { kind: "none", person_id: null, name: null, refresh: "7d", minor: false }, life: { enabled: false, seed: "" } });
    if (!made.ok) throw new Error("The synth fixture could not be created. Check the owner profile.");
    const response = await client.get(`/api/talent/synths/${made.value.id}/credits`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ shows: [], films: [], bands: [] });
  });

  test("a child receives 404 for credits of a synth above their audience", async () => {
    const { client, row } = await owner();
    const made = await createSynth(row, { persona: { display_name: "Grown Moss", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "adult" } as never, based_on: { kind: "none", person_id: null, name: null, refresh: "7d", minor: false }, life: { enabled: false, seed: "" } });
    if (!made.ok) throw new Error("The adult synth fixture could not be created. Check the owner profile.");
    const kid = await child(client);
    const response = await kid.client.get(`/api/talent/synths/${made.value.id}/credits`);
    expect(response.status).toBe(404);
  });
});
