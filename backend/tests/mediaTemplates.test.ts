import { beforeEach, describe, expect, test } from "bun:test";
import { MediaTemplate } from "@maipai/spec/gen/ts/media-template.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { listTemplates } from "@/lib/media/templates";
import type { PersonRow } from "@/types";
import { db } from "@/db";
import { people, sessions } from "@/db/schema";
import { createHash } from "node:crypto";
import { resetDb } from "./reset-db";
import { app } from "@/app";

beforeEach(() => resetDb());

const actor = (role: string) => ({ id: `person-${role}`, role } as PersonRow);

describe("picture templates", () => {
  test("validates every bundled record against the pinned spec schema", () => {
    const root = join(import.meta.dir, "../packages/generate_image/images/templates");
    const files = readdirSync(root).filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(17);
    for (const file of files) expect(MediaTemplate.safeParse(JSON.parse(readFileSync(join(root, file), "utf8"))).success).toBe(true);
  });

  test("all ages reach children and teens, while adult-only records are adult-only", () => {
    const child = listTemplates({ actor: actor("child"), kind: "picture" });
    const teen = listTemplates({ actor: actor("teen"), kind: "picture" });
    const adult = listTemplates({ actor: actor("adult"), kind: "picture" });
    expect(child.length).toBeGreaterThanOrEqual(17);
    expect(child.every((row) => row.audience === "all-ages")).toBe(true);
    expect(teen.every((row) => row.audience === "all-ages")).toBe(true);
    expect(adult.some((row) => row.audience === "adult-only")).toBe(true);
  });

  test("GET /api/media-templates returns signed-in, audience-filtered picture records", async () => {
    const now = new Date().toISOString();
    const token = "template-route-session";
    db.insert(people).values({ id: "template-child", displayName: "Nova", role: "child", avatarSeed: "nova", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
    db.insert(sessions).values({ id: "template-session", personId: "template-child", tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
    const response = await app.request("http://localhost/api/media-templates?kind=picture", { headers: { cookie: `session=${token}` } });
    expect(response.status).toBe(200);
    const body = await response.json() as { templates: Array<{ audience: string; kind: string }> };
    expect(body.templates.length).toBeGreaterThanOrEqual(17);
    expect(body.templates.every((row) => row.kind === "picture" && row.audience === "all-ages")).toBe(true);
  });
});
