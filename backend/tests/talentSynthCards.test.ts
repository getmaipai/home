import { beforeEach, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { companionsRoutes } from "@/routes/companions";
import { createSynth, forkSynth, updateSynth } from "@/lib/synths";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { createMediaProduction } from "@/lib/mediaProductions";
import { resetDb } from "./reset-db";
import { owner } from "./support/testAuth";

const app = new OpenAPIHono();
app.route("/api/companions", companionsRoutes);
const persona = { display_name: "Atlas", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", audience: "all" } as const;
const invented = { kind: "none", person_id: null, name: null, refresh: "7d", minor: false } as const;

beforeEach(() => resetDb());

test("companion synth cards show origin, ownership, and shows", async () => {
  const { client, row } = await owner();
  const base = await createSynth(row, { persona, based_on: invented, life: { enabled: true, seed: "" } });
  expect(base.ok).toBe(true);
  if (!base.ok) return;
  const baseList = await (await client.get("/api/companions")).json() as any;
  expect(baseList.companions.find((card: any) => card.id === base.value.id).synth).toMatchObject({ based_on: { kind: "none", name: null }, forked_from: null, yours: false });

  const fork = forkSynth(row, base.value.id);
  expect(fork.ok).toBe(true);
  if (!fork.ok) return;
  const forkList = await (await client.get("/api/companions")).json() as any;
  expect(forkList.companions.find((card: any) => card.id === fork.value.id).synth).toMatchObject({ forked_from: base.value.id, forked_from_name: "Atlas", yours: true });

  const subject = createMediaSubject(row, { name: "Atlas", kind: "character", look: "a friendly star guide" });
  expect(updateSynth(row, base.value.id, { subject_id: subject.id }).ok).toBe(true);
  createMediaProduction(row, {
    title: "Morning Briefing",
    show: { format_id: "news_briefing", audience: "all", household_facts: true, sources: [{ kind: "news", topics: ["space"], file_ids: [], media_item_id: null }], schedule: { every: "1d", at: "07:00", days: [] }, length_s: 300, state: null, stand_in_synth_id: null },
    cast: [{ subject_id: subject.id, role: "Anchor", synth_id: base.value.id, part: "host" }],
  });
  const detailed = await (await client.get(`/api/companions/${base.value.id}`)).json() as any;
  expect(detailed.synth.shows).toEqual([{ production_id: expect.any(String), title: "Morning Briefing", part: "host" }]);
});
