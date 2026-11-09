import { expect, test } from "bun:test";
import { Hono } from "hono";
import { compressAssets, hashedAssetCache } from "@/middleware/assetCache";

const app = new Hono();
app.use("/assets/*", compressAssets);
app.use("/assets/*", hashedAssetCache);
app.get("/assets/app-abc123.js", (c) => c.body("x".repeat(5000), 200, { "Content-Type": "text/javascript" }));
app.get("/assets/missing.js", (c) => c.body("no", 404, { "Content-Type": "text/plain" }));
app.get("/api/photo", (c) => c.body("p".repeat(5000), 200, { "Content-Type": "image/png" }));

test("a hashed asset is compressed and kept for a year", async () => {
  const res = await app.request("/assets/app-abc123.js", { headers: { "Accept-Encoding": "gzip" } });
  expect(res.headers.get("Content-Encoding")).toBe("gzip");
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
});

test("a missing asset is not cached and other routes are left alone", async () => {
  const missing = await app.request("/assets/missing.js");
  expect(missing.headers.get("Cache-Control")).toBeNull();
  const photo = await app.request("/api/photo", { headers: { "Accept-Encoding": "gzip" } });
  expect(photo.headers.get("Content-Encoding")).toBeNull();
});
