import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { people } from "@/db/schema";
import { __setImageToolsForTests } from "@/lib/imageEdit";
import { listMediaOps, registeredMediaOps, runMediaOp } from "@/lib/mediaOps/registry";
import "@/lib/mediaOps/picture";
import { resetDb } from "./reset-db";

function person(id: string, role: string) { const now = new Date().toISOString(); db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run(); return db.select().from(people).all().find(p => p.id === id)!; }

 describe("media operation registry", () => {
 test("lists only operations allowed for the actor, including the child cartoon lane and no guest", async () => {
  resetDb(); __setImageToolsForTests({ state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: {}, operations: [], reason: null }, true);
  const adult = person("op-adult", "owner"), teen = person("op-teen", "teen"), child = person("op-child", "child"), guest = person("op-guest", "guest");
  const ids = (await listMediaOps(adult, { input: "picture" })).map(x => x.id);
  expect(ids).toContain("picture.change"); expect(ids).not.toContain("picture.locate");
  expect((await listMediaOps(adult, { input: "picture", includeHelpers: true })).map(x => x.id)).toContain("picture.locate");
  expect((await listMediaOps(teen, { input: "picture" })).map(x => x.id)).toEqual(ids);
  expect((await listMediaOps(child, { input: "picture" })).map(x => x.id)).toEqual(ids);
  expect(await listMediaOps(guest, { input: "picture" })).toEqual([]);
 });
 test("locate is helper-only, open to every age, and refused to guests", async () => {
  resetDb(); __setImageToolsForTests({ state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: {}, operations: [], reason: null }, true);
  const adult = person("locate-adult", "owner"), teen = person("locate-teen", "teen"), child = person("locate-child", "child"), guest = person("locate-guest", "guest");
  expect((await listMediaOps(adult, { input: "picture", includeHelpers: true })).find((op) => op.id === "picture.locate")?.ready).toBe(true);
  expect((await listMediaOps(teen, { input: "picture", includeHelpers: true })).find((op) => op.id === "picture.locate")?.ready).toBe(true);
  expect((await listMediaOps(child, { input: "picture", includeHelpers: true })).find((op) => op.id === "picture.locate")?.ready).toBe(true);
  await expect(runMediaOp(guest, "picture.locate", { source: { kind: "picture", via: "chat", id: "x", conversationId: "c" }, args: {} })).rejects.toMatchObject({ status: 403 });
 });
 test("every op has descriptive copy and controls", () => { for (const op of registeredMediaOps()) { expect(op.label.length).toBeGreaterThan(0); expect(op.summary.length).toBeGreaterThan(0); expect(Array.isArray(op.controls)).toBe(true); } });
 test("unknown ids are refused and a Library ref that is not the actor's picture is a 404 (IMG-OPS-02)", async () => {
  resetDb(); const actor = person("op-adult", "owner");
  await expect(runMediaOp(actor, "picture.unknown", { source: { kind: "picture", via: "chat", id: "x", conversationId: "c" }, args: {} })).rejects.toMatchObject({ status: 404 });
  await expect(runMediaOp(actor, "picture.erase", { source: { kind: "picture", via: "file", id: "x" }, args: { mask: new Uint8Array([1]) } })).rejects.toMatchObject({ status: 404 });
 });
 test("routes and picture tools do not contain registered operation id literals", () => {
  const ids = registeredMediaOps().map(op => op.id); const root = join(import.meta.dir, "../src");
  const files = [join(root, "routes"), join(root, "lib/pictures")].flatMap(dir => readdirSync(dir, { recursive: true }).map(file => join(dir, String(file))).filter(file => file.endsWith(".ts")));
  for (const file of files) { if (file.includes("mediaOps")) continue; const text = readFileSync(file, "utf8"); for (const id of ids) expect(text).not.toContain(`"${id}"`); }
 });
});
