import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { listFragments } from "@/lib/media/templates";
import { editPictureSpec } from "@/lib/mediaOps/chatSchema";
import { listMediaOps, runMediaOp } from "@/lib/mediaOps/registry";
import { PICTURE_COVERAGE } from "@/lib/mediaOps/coverage";
import { resetDb } from "./reset-db";

function person(id: string, role = "owner") {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get()!;
}

describe("picture angle and coverage operations", () => {
  beforeEach(resetDb);

  test("both operations are listed for pictures and appear in edit_picture's registry enum", async () => {
    const actor = person("angle-owner");
    const ops = await listMediaOps(actor, { input: "picture" });
    for (const id of ["picture.angle", "picture.coverage"] as const) expect(ops.map((op) => op.id)).toContain(id);
    const angle = ops.find((op) => op.id === "picture.angle")!;
    expect(angle).toMatchObject({ label: "Change the angle", input: "picture", output: "picture", needs: "image", minBand: "child" });
    expect(angle.controls[0]).toMatchObject({ kind: "choice", name: "angle", options: listFragments({ actor, group: "angle" }).map((row) => row.title) });
    const schema = editPictureSpec("edit_picture", { editPictureAllowed: true, editPictureOps: ops, editPictureIds: [], actor } as never)!;
    expect((schema.args.properties as { op: { enum: string[] } }).op.enum).toContain("picture.angle");
    expect((schema.args.properties as { op: { enum: string[] } }).op.enum).toContain("picture.coverage");
  });

  test("unknown angle ids are refused before a source or edit can start", async () => {
    const actor = person("angle-unknown");
    await expect(runMediaOp(actor, "picture.angle", { source: { kind: "picture", via: "file", id: "missing" }, args: { angle: "not-an-angle" } })).rejects.toMatchObject({ status: 422, message: "Choose an available picture angle." });
  });

  test("coverage has one fixed instruction for each supported shot size", () => {
    expect(Object.keys(PICTURE_COVERAGE)).toEqual(["wide", "medium", "close"]);
    for (const instruction of Object.values(PICTURE_COVERAGE)) expect(instruction).toEndWith("keeping the same person, outfit and place.");
  });
});
