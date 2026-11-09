import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { checkClipFrames, sharpness } from "../src/lib/videos/frameCheck";

const S = 128;
async function jpeg(fill: (x: number, y: number) => number, blur = 0): Promise<Uint8Array> {
  const raw = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = fill(x, y); const i = (y * S + x) * 3; raw[i] = v; raw[i + 1] = v; raw[i + 2] = v; }
  let img = sharp(raw, { raw: { width: S, height: S, channels: 3 } });
  if (blur) img = img.blur(blur);
  return new Uint8Array(await img.jpeg({ quality: 95 }).toBuffer());
}
const checker = (shift: number) => (x: number, y: number) => ((Math.floor((x + shift) / 4) + Math.floor(y / 4)) % 2 ? 230 : 40);

describe("checkClipFrames", () => {
  test("a clip whose frames differ and are sharp has no findings", async () => {
    const r = await checkClipFrames([await jpeg(checker(0)), await jpeg(checker(2)), await jpeg(checker(5))], 5);
    expect(r).toMatchObject({ checked: true, frames: 3, findings: [] });
  });
  test("a black frame is serious", async () => {
    const r = await checkClipFrames([await jpeg(checker(0)), await jpeg(() => 2), await jpeg(checker(3))], 5);
    expect(r.findings.map((f) => f.code)).toContain("black");
    expect(r.findings.find((f) => f.code === "black")?.level).toBe("serious");
  });
  test("identical frames in a clip of two seconds or more mean nothing moves; a very short clip is not judged", async () => {
    const same = [await jpeg(checker(0)), await jpeg(checker(0)), await jpeg(checker(0))];
    expect((await checkClipFrames(same, 5)).findings.map((f) => f.code)).toContain("frozen");
    expect((await checkClipFrames(same, 1)).findings.map((f) => f.code)).not.toContain("frozen");
  });
  test("one much softer frame is a warning", async () => {
    const r = await checkClipFrames([await jpeg(checker(0)), await jpeg(checker(2), 6), await jpeg(checker(5))], 5);
    expect(r.findings.find((f) => f.code === "soft")?.level).toBe("warning");
  });
  test("no frames means unchecked and no claim", async () => {
    expect(await checkClipFrames(null, 5)).toEqual({ checked: false, frames: 0, findings: [] });
  });
  test("sharpness is higher for a sharp pattern than a flat one", () => {
    const sharpPx = new Uint8Array(96 * 96).map((_, i) => ((i % 96) + Math.floor(i / 96)) % 2 ? 255 : 0);
    expect(sharpness(sharpPx)).toBeGreaterThan(sharpness(new Uint8Array(96 * 96).fill(100)));
  });
});

import { beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

describe("GET /api/videos/jobs/:id/check", () => {
  let client: TestClient;
  beforeEach(async () => { resetDb(); client = new TestClient(); await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" }); });
  test("an unknown clip is 404 and nobody is 401", async () => {
    expect((await client.get("/api/videos/jobs/none/check")).status).toBe(404);
    expect((await new TestClient().get("/api/videos/jobs/none/check")).status).toBe(401);
  });
});
