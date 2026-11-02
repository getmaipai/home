// VIDEO-CREATE-02 (U3): GET /api/plugins/:id/assets/<path>. A package's own loops and pictures: authenticated, the page's access rule,
// path-traversal safe, only mp4/webp/png/jpg, hashed ETag with a long cache, and byte ranges for the video element.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { packageInstalls } from "@/db/schema";
import { PACKAGES_DIR, installedPackageVersionDir } from "@/lib/paths";
import { assetResponse, cleanAssetPath, MAX_ASSET_BYTES, packageAssetFile } from "@/lib/packageAssets";

beforeEach(() => resetDb());

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const signIn = async (displayName: string, role: string, extra: Record<string, unknown> = {}) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...extra });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return client;
  };
  return { owner, adult: await signIn("Marlow", "adult"), teen: await signIn("Nova", "teen", { birthdate: "2011-03-01" }), child: await signIn("Sprout", "child", { birthdate: "2018-03-01" }) };
}

const LOOP = "loops/natural.mp4";
const URL_OF = (path: string) => `/api/plugins/videos/assets/${path}`;
const onDisk = () => Bun.file(join(PACKAGES_DIR, "videos", "assets", LOOP));

describe("the asset route", () => {
  test("needs a signed-in person", async () => {
    expect((await new TestClient().get(URL_OF(LOOP))).status).toBe(401);
  });

  test("an adult gets the file with its type, a hashed ETag and a short revalidated cache; the same ETag answers 304", async () => {
    const { adult } = await household();
    const res = await adult.get(URL_OF(LOOP));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600, must-revalidate");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const etag = res.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(await onDisk().arrayBuffer()))).toBe(true);
    const again = await adult.get(URL_OF(LOOP), { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect((await adult.get(URL_OF(LOOP), { "if-none-match": '"other"' })).status).toBe(200);
  });

  test("a byte range gets 206 with the right slice; an impossible range gets 416", async () => {
    const { adult } = await household();
    const whole = Buffer.from(await onDisk().arrayBuffer());
    const part = await adult.get(URL_OF(LOOP), { range: "bytes=10-19" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 10-19/${whole.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(whole.subarray(10, 20))).toBe(true);
    const tail = await adult.get(URL_OF(LOOP), { range: "bytes=-5" });
    expect(tail.status).toBe(206);
    expect(Buffer.from(await tail.arrayBuffer()).equals(whole.subarray(whole.length - 5))).toBe(true);
    expect((await adult.get(URL_OF(LOOP), { range: `bytes=${whole.length + 5}-` })).status).toBe(416);
  });

  test("the Create page's floor applies: a teen and a child get the same 404 as a missing file", async () => {
    const { teen, child, adult } = await household();
    const missing = await adult.get(URL_OF("loops/nothing.mp4"));
    expect(missing.status).toBe(404);
    const missingBody = await missing.json();
    for (const other of [teen, child]) {
      const res = await other.get(URL_OF(LOOP));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(missingBody);
    }
  });

  test("a package that is not an app, or does not exist, has no assets", async () => {
    const { adult } = await household();
    expect((await adult.get("/api/plugins/almanac-date/assets/loops/natural.mp4")).status).toBe(404);
    expect((await adult.get("/api/plugins/nonesuch/assets/loops/natural.mp4")).status).toBe(404);
  });

  test("a name that climbs out, hides, or is not a served type is a 404", async () => {
    const { adult } = await household();
    for (const bad of ["loops%2f..%2f..%2fmanifest.json", "..%2fmanifest.json", "%2e%2e%2fmanifest.json", "loops%2f%2e%2e%2f..%2fmanifest.json", "loops%5cnatural.mp4", "loops%2f.natural.mp4", "loops", "loops%2f", "manifest.json", "pages%2fmake-video.json", "loops%2fnatural.mp4%00.png", "loops%2fnatural.exe"]) {
      expect(`${bad} ${(await adult.get(URL_OF(bad))).status}`).toBe(`${bad} 404`);
    }
  });
});

describe("packageAssetFile", () => {
  const id = "assettest";
  const root = installedPackageVersionDir(id, "1.0.0");
  const outside = join(tmpdir(), `asset-outside-${process.pid}.mp4`);
  beforeEach(() => {
    mkdirSync(join(root, "assets", "loops"), { recursive: true });
    writeFileSync(join(root, "assets", "loops", "ok.mp4"), new Uint8Array(64).fill(7));
    writeFileSync(join(root, "assets", "loops", "ok.WEBP"), new Uint8Array(64).fill(8));
    writeFileSync(join(root, "assets", "notes.txt"), "plain");
    writeFileSync(join(root, "assets", "big.mp4"), new Uint8Array(MAX_ASSET_BYTES + 1));
    writeFileSync(join(root, "assets", "empty.mp4"), new Uint8Array(0));
    writeFileSync(join(root, "secret.mp4"), new Uint8Array(64).fill(9));
    writeFileSync(outside, new Uint8Array(64).fill(1));
    symlinkSync(outside, join(root, "assets", "loops", "link.mp4"));
    symlinkSync(dirname(outside), join(root, "assets", "linkdir"));
    db.insert(packageInstalls).values({ packageId: id, version: "1.0.0", channel: "stable", sourceCommit: "abc", permissions: "[]", installedAt: new Date().toISOString() }).run();
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { force: true }); });

  test("serves a plain file inside assets/ with its type from the extension, in any letter case", () => {
    expect(packageAssetFile(id, "loops/ok.mp4")).toMatchObject({ size: 64, mediaType: "video/mp4" });
    expect(packageAssetFile(id, "loops/ok.WEBP")?.mediaType).toBe("image/webp");
    expect(packageAssetFile(id, "loops/ok.mp4")!.etag).toBe(packageAssetFile(id, "loops/ok.mp4")!.etag);
  });
  test("refuses a type not on the list, an empty or oversized file, a hidden or dotted name, and any climb", () => {
    for (const bad of ["notes.txt", "big.mp4", "empty.mp4", "loops/.ok.mp4", "../secret.mp4", "loops/../../secret.mp4", "loops/../notes.txt", "/etc/passwd", "loops//ok.mp4", "loops", "ok", "loops/nothing.mp4"]) expect(packageAssetFile(id, bad)).toBeNull();
    expect(packageAssetFile("../videos", "loops/natural.mp4")).toBeNull();
    expect(packageAssetFile("Videos", "loops/natural.mp4")).toBeNull();
  });
  test("refuses a symbolic link that leaves assets/, to a file or a folder", () => {
    expect(packageAssetFile(id, "loops/link.mp4")).toBeNull();
    expect(packageAssetFile(id, `linkdir/${outside.slice(outside.lastIndexOf("/") + 1)}`)).toBeNull();
  });
  test("cleanAssetPath keeps plain names and rejects the rest", () => {
    expect(cleanAssetPath("loops/a%20b.mp4")).toBe("loops/a b.mp4");
    for (const bad of ["", "..", "a/../b", "a\\b", "a%00b", "%2e%2e/x", "a//b", ".hidden/x.mp4", "%E0%A4%A", "x".repeat(201)]) expect(cleanAssetPath(bad)).toBeNull();
  });
  test("assetResponse answers whole, range, 304 and 416", async () => {
    const asset = packageAssetFile(id, "loops/ok.mp4")!;
    expect(assetResponse(asset, {}).status).toBe(200);
    expect(assetResponse(asset, { range: "bytes=0-9" }).status).toBe(206);
    expect(assetResponse(asset, { range: "bytes=900-" }).status).toBe(416);
    expect(assetResponse(asset, { ifNoneMatch: asset.etag }).status).toBe(304);
  });
});

describe("appAssetAllowed names a file only by its whole path", () => {
  test("a root-level file whose name is a suffix of a mentioned path is not named, so it needs every page's floor", async () => {
    const { appAssetAllowed } = await import("@/lib/apps");
    const { adult, teen } = await household();
    void adult; void teen;
    const people = await import("@/db/schema");
    const rows = db.select().from(people.people).all();
    const teenRow = rows.find((r) => r.displayName === "Nova")!;
    // Index page mentions neither; no page document holds "natural.mp4" as a whole value, though "loops/natural.mp4" ends with it.
    expect(appAssetAllowed(teenRow as never, "videos", "natural.mp4")).toBe(false);
    expect(appAssetAllowed(teenRow as never, "videos", "loops/natural.mp4")).toBe(false);
  });
});
