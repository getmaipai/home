import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { owner, teen } from "./support/testAuth";
import { __setStageCompleterForTests } from "@/lib/longform/stages";
import { planStructure } from "@/lib/longform/structure";

const treatment = { title: "The Lighthouse", logline: "A keeper finds a boat.", look: "35mm", tone: "quiet", summary: "A keeper finds a boat." };
const bible = { cast: [{ name: "Marlow", description: "a keeper in a yellow coat" }], locations: [{ name: "Tower", description: "a white tower" }], music: [], rules: [] };
function fake(seconds: number) {
  const r = planStructure(seconds); const keys = r.ok ? r.plan.scenes.map((s) => s.key) : [];
  __setStageCompleterForTests(async (m) => {
    const sys = m[0]!.content as string;
    if (sys.includes("treatment for")) return { ok: true, text: JSON.stringify(treatment) };
    if (sys.includes("bible for")) return { ok: true, text: JSON.stringify(bible) };
    return { ok: true, text: JSON.stringify({ scenes: keys.map((key) => ({ key, title: key, location: "Tower", cast: ["Marlow"], beat: "b" })) }) };
  });
}
beforeEach(() => resetDb());
afterEach(() => __setStageCompleterForTests(null));

describe("long-form production routes", () => {
  test("pitch, approve, bible, approve, outline; render only after the bible is approved", async () => {
    fake(300); const { client } = await owner();
    const made = await client.post("/api/productions/long", { idea: "a keeper finds a boat", seconds: 300 }); expect(made.status).toBe(200);
    const { production_id: id, may_render } = await made.json() as { production_id: string; may_render: boolean }; expect(may_render).toBe(false);
    expect((await client.post(`/api/productions/long/${id}/bible`, {})).status).toBe(400);
    expect((await client.post(`/api/productions/long/${id}/approve`, { kind: "treatment" })).status).toBe(200);
    expect((await client.post(`/api/productions/long/${id}/bible`, {})).status).toBe(200);
    const ok = await client.post(`/api/productions/long/${id}/approve`, { kind: "bible" }); expect(((await ok.json()) as { may_render: boolean }).may_render).toBe(true);
    expect((await client.post(`/api/productions/long/${id}/outline`, {})).status).toBe(200);
    const read = await client.get(`/api/productions/long/${id}`); expect(((await read.json()) as { documents: unknown[] }).documents.length).toBe(3);
  });
  test("a teen is refused and an unknown production is 404", async () => {
    fake(300); const { client } = await owner(); const t = await teen(client);
    expect((await t.post("/api/productions/long", { idea: "a boat", seconds: 300 })).status).toBe(400);
    expect((await client.get("/api/productions/long/missing")).status).toBe(404);
  });
});
