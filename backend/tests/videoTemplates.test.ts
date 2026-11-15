import { beforeEach, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeVideoStack } from "./videoFixture";
import { getTemplate, listTemplates, validVideoTemplateSettings, videoTemplateSettings } from "@/lib/media/templates";
import { templateCoverUrl } from "@/lib/templateCovers";
import { db } from "@/db";
import { people } from "@/db/schema";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());
test("video templates have valid settings and covers", async () => {
  const c = new TestClient(); await c.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const person = db.select().from(people).get()! as PersonRow;
  const templates = listTemplates({ actor: person, kind: "video" });
  expect(templates.length).toBeGreaterThanOrEqual(12);
  expect(validVideoTemplateSettings()).toBe(true);
  expect(Object.keys(videoTemplateSettings()).length).toBe(templates.length);
  for (const row of templates) expect(templateCoverUrl(row.id)).toBe(`/template-covers/${row.id}.jpg`);
});
test("video template data scope lists covers", async () => {
  const c = new TestClient(); await c.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const rows = await (await c.post("/api/plugins/video/data/recipes", { scope: "templates" })).json() as Array<{ id: string; thumbnail: string }>;
  expect(rows.length).toBeGreaterThanOrEqual(12); expect(rows.every((row) => row.thumbnail === templateCoverUrl(row.id))).toBe(true);
});
test("template request reaches the submitted video job with prompt and sidecar values", async () => {
  const fake = installFakeVideoStack();
  try {
    const c = new TestClient(); await c.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const template = listTemplates({ actor: db.select().from(people).get()! as PersonRow, kind: "video" })[0]!;
    const setting = videoTemplateSettings()[template.id]!;
    const res = await c.post("/api/plugins/video/actions/make", { prompt: "Use a slow reveal", template: template.id });
    expect(res.status).toBe(200);
    expect(fake.submitted[0]!.prompt).toContain(template.prompt);
    expect(fake.submitted[0]!.prompt).toContain("Use a slow reveal");
    expect(fake.submitted[0]!.seconds).toBe(Math.min(setting.seconds, 5));
    expect(fake.submitted[0]!.size).toMatch(/^\d+x\d+$/);
  } finally { fake.restore(); }
});
test("explicit settings beat template defaults and unknown template starts no job", async () => {
  const fake = installFakeVideoStack();
  try {
    const c = new TestClient(); await c.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const person = db.select().from(people).get()! as PersonRow; const template = listTemplates({ actor: person, kind: "video" })[0]!;
    const response = await c.post("/api/plugins/video/actions/make", { prompt: "Extra direction", template: template.id, seconds: 10, orientation: "landscape" });
    expect(response.status).toBe(200); expect(fake.submitted[0]!.seconds).toBe(5); expect(fake.submitted[0]!.size).toMatch(/^\d+x\d+$/);
    const bad = await c.post("/api/plugins/video/actions/make", { prompt: "A video prompt", template: "mtpl-missing" });
    expect(bad.status).toBe(422); expect(fake.submitted).toHaveLength(1);
  } finally { fake.restore(); }
});
