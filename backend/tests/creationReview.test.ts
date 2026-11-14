import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { creations } from "@/db/schema";
import { creationOfFile, recordCreation, reviewOfFile } from "@/lib/creations/store";
import { validateCreationRecord } from "@maipai/spec/records/ts/validate.js";
import { resetDb } from "./reset-db";
import { household } from "./fixtures/adultLock";
import { makePicture } from "./fixtures/adultLockPicture";

beforeEach(() => resetDb());

describe("CREATOR-30 review", () => {
  test("the maker sets each review value and reads it back on a valid record", async () => {
    const h = await household();
    const maker = h.row("Marlow");
    const picture = await makePicture(maker, "all-ages", "boat");
    const creation = recordCreation(maker, { kind: "picture", fileIds: [picture.id], recipe: { tool: "pictures", route: "text" } })!;

    for (const review of ["kept", "rejected", "pending"] as const) {
      const response = await h.adult.client.post(`/api/creations/by-file/${picture.id}/review`, { review });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ review });
      expect(creationOfFile(maker.id, picture.id)?.review).toBe(review);
      expect(reviewOfFile(maker.id, picture.id)).toBe(review);
    }
    expect(validateCreationRecord(creationOfFile(maker.id, picture.id)!)).toEqual([]);
    expect(creation.id).toBe(creationOfFile(maker.id, picture.id)!.id);
  });

  test("a different person cannot change the maker's review", async () => {
    const h = await household();
    const maker = h.row("Marlow");
    const picture = await makePicture(maker, "all-ages", "boat");
    recordCreation(maker, { kind: "picture", fileIds: [picture.id], recipe: { tool: "pictures", route: "text" } });

    const response = await h.other.client.post(`/api/creations/by-file/${picture.id}/review`, { review: "kept" });
    expect(response.status).toBe(404);
  });

  test("a minor gets not found for a locked adult-only file", async () => {
    const h = await household();
    const maker = h.row("Nova");
    const picture = await makePicture(maker, "adult-only", "hidden");
    recordCreation(maker, { kind: "picture", fileIds: [picture.id], recipe: { tool: "pictures", route: "text" } });

    const response = await h.child.client.post(`/api/creations/by-file/${picture.id}/review`, { review: "kept" });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("hidden");
  });

  test("an invalid review value gets a plain 400 sentence", async () => {
    const h = await household();
    const maker = h.row("Marlow");
    const picture = await makePicture(maker, "all-ages", "boat");
    recordCreation(maker, { kind: "picture", fileIds: [picture.id], recipe: { tool: "pictures", route: "text" } });

    const response = await h.adult.client.post(`/api/creations/by-file/${picture.id}/review`, { review: "approved" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Review must be kept, rejected, or pending." });
    expect(db.select().from(creations).get()?.review).toBe("pending");
  });
});
