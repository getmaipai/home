import { beforeEach, describe, expect, test } from "bun:test";
import { animaticShotOps } from "../src/lib/films/animatic";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

const shot = (over: Record<string, unknown>) => ({ id: "s1", still: "A lighthouse at dusk, cartoon", line: "The light came on at six.", seconds: 5, motion: "zoom in", ...over }) as never;

describe("animaticShotOps", () => {
  test("zoom in holds the still for the shot length and shows its line", () => {
    expect(animaticShotOps(shot({}))).toEqual([
      { op: "kenburns", zoom_from: 1, zoom_to: 1.2, pan: "none", duration_s: 5 },
      { op: "captions", lines: [{ from_s: 0, to_s: 5, text: "The light came on at six." }], position: "bottom" },
    ]);
  });
  test("zoom out and pans map to the Stack's own terms; no line means no captions", () => {
    expect(animaticShotOps(shot({ motion: "zoom out", line: "" }))).toEqual([{ op: "kenburns", zoom_from: 1.2, zoom_to: 1, pan: "none", duration_s: 5 }]);
    expect((animaticShotOps(shot({ motion: "pan left" }))[0] as { pan: string }).pan).toBe("left");
    expect((animaticShotOps(shot({ motion: "pan right" }))[0] as { pan: string }).pan).toBe("right");
  });
});

describe("POST /api/films/:id/animatic", () => {
  let client: TestClient;
  beforeEach(async () => { resetDb(); client = new TestClient(); await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" }); });
  test("an unknown film is 404 and nobody is 401", async () => {
    expect((await client.post("/api/films/none/animatic", {})).status).toBe(404);
    expect((await new TestClient().post("/api/films/none/animatic", {})).status).toBe(401);
  });
});
