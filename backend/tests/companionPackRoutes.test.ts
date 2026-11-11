import { beforeEach, describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { db } from "@/db";
import { people, sessions } from "@/db/schema";
import { companionsRoutes } from "@/routes/companions";
import { createHouseholdCompanion, householdCompanionFolder, setHouseholdCompanionAudience, setHouseholdCompanionStatus } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { __reloadPersonasForTests } from "@/lib/persona";
import { resetDb } from "./reset-db";

const app = new OpenAPIHono();
app.route("/api/companions", companionsRoutes);
const now = new Date().toISOString();
const specFixture = join(dirname(Bun.resolveSync("@maipai/spec/package.json", import.meta.dir)), "fixtures", "companion-pack", "valid-man.json");

function addPerson(id: string, role: string, birthdate?: string) {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test", ...(birthdate ? { birthdate } : {}) } as never).run();
  const token = `session-${id}`;
  db.insert(sessions).values({ id: `sess-${id}`, personId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return token;
}
const get = (path: string, token: string, extra: Record<string, string> = {}) => app.request(`http://localhost/api/${path}`, { headers: { cookie: `session=${token}`, ...extra } });

/** Writes every file the fixture pack names (tiny placeholders) into the companion's pack folder. */
function installFakePack(id: string, mutate?: (pack: any) => void) {
  const pack = JSON.parse(readFileSync(specFixture, "utf8"));
  mutate?.(pack);
  const dir = join(householdCompanionFolder(id)!, "pack");
  rmSync(dir, { recursive: true, force: true });
  const put = (rel: string, body: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };
  put("pack.json", JSON.stringify(pack));
  put(pack.rest, "webp-bytes");
  for (const clips of Object.values<any[]>(pack.states)) for (const c of clips) { put(c.file, "0123456789"); put(c.trackFile, "[]"); if (c.phone) put(c.phone, "phone"); }
  for (const d of [pack.mouth.calm.dir, pack.mouth.shout?.dir, pack.head.dir, pack.eyes.dir, pack.emotion.dir]) if (d) put(`${d}/meta.json`, "{}");
  put("head/flow.z", "zzzz");
  return pack;
}

describe("companion pack routes", () => {
  let owner: string, child: string, id: string, pack: any;
  beforeEach(() => {
    resetDb();
    owner = addPerson("pack-owner", "owner");
    child = addPerson("pack-child", "child", "2018-01-01");
    const loaded = loadManifestOnly("rivet"); if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable");
    const made = createHouseholdCompanion({ ...loaded.value.companion, display_name: "Pack fox" }, { display_name: "Author", person_id: "pack-owner" });
    if (!made.ok) throw new Error(made.error);
    id = made.value.id;
    setHouseholdCompanionAudience(id, "adult", { display_name: "Admin" }); setHouseholdCompanionStatus(id, "ready"); __reloadPersonasForTests();
    pack = installFakePack(id);
  });

  test("avatar carries the pack url and manifest when the pack is valid", async () => {
    const body = await (await get(`companions/avatar?companion=${id}`, owner)).json() as { avatar: { pack: { url: string; manifest: { id: string } } | null } | null };
    expect(body.avatar?.pack?.url).toBe(`/api/companions/${id}/pack/`);
    expect(body.avatar?.pack?.manifest.id).toBe(pack.id);
  });

  test("the small avatar still is a square tile, never the wide rest frame squashed into a square", async () => {
    const wide = await sharp({ create: { width: 1024, height: 576, channels: 3, background: "#888888" } }).webp().toBuffer();
    writeFileSync(join(householdCompanionFolder(id)!, "pack", pack.rest), wide);
    const body = await (await get(`companions/avatar?companion=${id}`, owner)).json() as { avatar: { portrait: string | null } };
    expect(body.avatar.portrait).toBe(`/api/companions/${id}/pack-still`);
    const res = await get(`companions/${id}/pack-still`, owner);
    expect(res.status).toBe(200);
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
  });

  test("an invalid pack gives pack null", async () => {
    installFakePack(id, (p) => { p.states.idle[0].track.pop(); });
    const body = await (await get(`companions/avatar?companion=${id}`, owner)).json() as { avatar: { pack: unknown } | null };
    expect(body.avatar?.pack ?? null).toBeNull();
  });

  test("pack files are served with mime types and Range", async () => {
    const clip = pack.states.idle[0].file as string;
    const full = await get(`companions/${id}/pack/${clip}`, owner);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toContain("video/mp4");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    const part = await get(`companions/${id}/pack/${clip}`, owner, { range: "bytes=2-5" });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("2345");
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect((await get(`companions/${id}/pack/${pack.rest}`, owner)).headers.get("content-type")).toContain("image/webp");
    expect((await get(`companions/${id}/pack/pack.json`, owner)).headers.get("content-type")).toContain("application/json");
    expect((await get(`companions/${id}/pack/head/flow.z`, owner)).headers.get("content-type")).toContain("application/octet-stream");
  });

  test("the audience guard, path escapes and unknown files are refused", async () => {
    const clip = pack.states.idle[0].file as string;
    expect((await get(`companions/${id}/pack/${clip}`, child)).status).toBe(404);
    expect((await get(`companions/${id}/pack/..%2Fanimation%2Fx.mp4`, owner)).status).toBe(404);
    expect((await get(`companions/${id}/pack/nothing.mp4`, owner)).status).toBe(404);
    expect((await get(`companions/${id}/pack/notes.txt`, owner)).status).toBe(404);
    const anon = await app.request(`http://localhost/api/companions/${id}/pack/${clip}`);
    expect(anon.status).toBe(401);
  });

  test("an invalid pack serves no files", async () => {
    installFakePack(id, (p) => { p.states.idle[0].track.pop(); });
    expect((await get(`companions/${id}/pack/pack.json`, owner)).status).toBe(404);
  });
});
