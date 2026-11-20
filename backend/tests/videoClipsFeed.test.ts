// CLIPS-FEED-01: the Videos Clips view. A `clip_feed` page over the `recipes` scope `short`: the short clips (60 seconds or less) a person sees in their own
// Library, made at home, own and shared. No new store; a person sees what the Library shows them, lock and age rules as they are. The first row of a child
// carries `autoplay: false`. Local data only; no live video service.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { storeFile } from "@/lib/attachments";
import { putStamp } from "@/lib/filter/stamps";
import { ContentRating } from "@maipai/spec/ratings/ts/contentRating";
import { testMp4 } from "./videoFixture";
import { until } from "./pictureFixture";
import { PACKAGES_DIR } from "@/lib/paths";
import { SHORT_CLIP_MAX_S, isShortClip, shortClipRows } from "@/lib/media/videoCreateApp";
import { PACKAGE_PAGE_NODE_TYPES } from "@maipai/spec/ui/app-check.js";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
// AGE-ROUTING-REMOVE-01: an adult's clips are made by the sound maker (the adult lane), so the Stack reports it ready.
beforeEach(() => { resetDb(); __resetVideoAdapterCacheForTests(); fake = installFakeVideoStack(); fake.ltx25 = "ready"; __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" })); });
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

const BOAT = "A paper boat floats down a rainy street, soft evening light";
type Row = Record<string, any>;

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const signIn = async (displayName: string, role: string, extra: Record<string, unknown> = {}) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...extra });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return { client, id: created.id };
  };
  const adult = await signIn("Marlow", "adult");
  const other = await signIn("Quill", "adult");
  const teen = await signIn("Nova", "teen", { birthdate: "2011-03-01" });
  const child = await signIn("Sprout", "child", { birthdate: "2018-03-01" });
  const row = (name: string) => db.select().from(peopleTable).where(eq(peopleTable.displayName, name)).get()! as PersonRow;
  return { owner, adult, other, teen, child, row };
}
// BLOCKER: the pinned spec's package-page checker (ui/app-check.ts PACKAGE_PAGE_NODE_TYPES, spec 0.1.355 and 0.1.356) does not list `clip_feed`, so a manifest that
// names the Clips page fails to load the whole Videos app. Until a spec tag adds it, the page file, the data scope and the checks below stand ready and the
// registration tests (marked skipIf) turn on by themselves once the pinned spec allows the node. The manifest and Videos home edits are in the hand-off patch.
const specAllowsClipFeed = PACKAGE_PAGE_NODE_TYPES.includes("clip_feed");
const short = async (client: TestClient) => (await client.post("/api/plugins/video/data/recipes", { scope: "short" })).json() as Promise<Row[]>;
const action = (client: TestClient, name: string, body: Record<string, unknown>) => client.post(`/api/plugins/video/actions/${name}`, body);
/** A silent clip (the Stack reported no sound) as the finished-clip job stores it, with the stored G stamp RATE-INGEST-01 writes for an all-ages mark. */
function silentClip(owner: PersonRow): string {
  const provenance = `video-gen:${JSON.stringify({ v: 1, audience: "all-ages", made_audience: "all-ages", lock: "off", creation: "crt-silent0001", job: "vid-silent0001", seed: 1, model: "wan2.2-ti2v-5b-fastwan-mlx", seconds: 5, width: 832, height: 480, quality: "quick", audio: false })}`;
  const stored = storeFile(owner, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: testMp4(), provenance, retention: "kept", deduplicate: false });
  if (!stored.ok) throw new Error(stored.error);
  putStamp({ kind: "attachment", id: stored.value.id }, ContentRating.parse({ level: "G", source: "given", rater: "audience-mark", rater_version: 1, rated_at: new Date().toISOString(), label: { system: "audience", value: "all-ages" } }), "test-silent-clip");
  return stored.value.id;
}
async function makeClip(client: TestClient, actor: PersonRow, body: Record<string, unknown> = { prompt: BOAT }) {
  const made = await (await client.post("/api/videos/make", body)).json() as { id: string };
  await until(() => getVideoJobFor(actor, made.id)?.state === "done");
  return { jobId: made.id, fileId: getVideoJobFor(actor, made.id)!.files[0]!.id };
}

describe("what counts as a short clip", () => {
  test("60 seconds or less, with a known length", () => {
    expect(SHORT_CLIP_MAX_S).toBe(60);
    expect(isShortClip(5)).toBe(true);
    expect(isShortClip(60)).toBe(true);
    expect(isShortClip(60.5)).toBe(false);
    expect(isShortClip(300)).toBe(false);
    expect(isShortClip(0)).toBe(false);
    expect(isShortClip(null)).toBe(false);
    expect(isShortClip(undefined)).toBe(false);
  });
});

describe("scope short: the clips feed rows", () => {
  test("an adult gets their own clips newest first, with the file, poster, title, length, heart and the words to make it again", async () => {
    const { adult, row } = await household();
    const actor = row("Marlow");
    const a = await makeClip(adult.client, actor);
    const b = await makeClip(adult.client, actor, { prompt: "Sunrise over a misty green valley, birds crossing the sky" });
    const rows = await short(adult.client);
    expect(rows.map((r) => r.id)).toEqual([b.fileId, a.fileId]);
    expect(rows[0]).toMatchObject({ src: `/api/files/${b.fileId}/content`, liked: false, prompt: "Sunrise over a misty green valley, birds crossing the sky" });
    expect(rows[0]!.poster).toMatch(/^\/api\/files\/[^/]+\/thumb/);
    expect(typeof rows[0]!.title).toBe("string");
    expect(rows[0]!.duration_s).toBeGreaterThan(0);
    expect(rows[0]!.duration_s).toBeLessThanOrEqual(SHORT_CLIP_MAX_S);
    // An adult's autoplay is not turned off.
    expect(rows.some((r) => "autoplay" in r)).toBe(false);
  });

  test("the Create page's stage is the newest take: it loops, says shape and length in plain words, names no model or pixel size, and a teen or child gets none", async () => {
    const { adult, teen, row } = await household();
    expect(await (await adult.client.post("/api/plugins/video/data/recipes", { scope: "stage" })).json()).toEqual([]);
    const made = await makeClip(adult.client, row("Marlow"));
    const stage = (await (await adult.client.post("/api/plugins/video/data/recipes", { scope: "stage" })).json()) as Row[];
    expect(stage).toHaveLength(1);
    expect(stage[0]).toMatchObject({ id: made.jobId, stage_state: "looping", eyebrow: "Latest take" });
    expect(String(stage[0]!.loop)).toMatch(/^\/api\//);
    expect(String(stage[0]!.description).length).toBeGreaterThan(0);
    expect(String(stage[0]!.subtitle)).toMatch(/^(Wide|Tall|Square) · \d+ seconds$/);
    expect(JSON.stringify(stage[0])).not.toMatch(/ltx|wan|h3|minimax|\d{3,4}\s*[x×]\s*\d{3,4}/i);
    expect((await teen.client.post("/api/plugins/video/data/recipes", { scope: "stage" })).status).toBe(404);
  });

  test("the feed after the stage starts at the second newest take; filtered feeds are unchanged", async () => {
    const { adult, row } = await household();
    const actor = row("Marlow");
    const a = await makeClip(adult.client, actor);
    const b = await makeClip(adult.client, actor, { prompt: "Sunrise over a misty green valley, birds crossing the sky" });
    const feed = async (extra: Record<string, unknown>) => (await (await adult.client.post("/api/plugins/video/data/recipes", { scope: "feed", ...extra })).json()) as Row[];
    expect((await feed({})).map((r) => r.id)).toEqual([b.jobId, a.jobId]);
    expect((await feed({ view: "after-stage" })).map((r) => r.id)).toEqual([a.jobId]);
    expect((await feed({ view: "after-stage", favorites: true })).length).toBe(0);
    const stage = (await (await adult.client.post("/api/plugins/video/data/recipes", { scope: "stage" })).json()) as Row[];
    expect(stage[0]!.id).toBe(b.jobId);
  });

  test("the stage offers Another take and Try again only while the video maker is ready; Edit and make again and Favorite stay", async () => {
    const { adult } = await household();
    const labels = async () => {
      const page = (await (await adult.client.get("/api/plugins/video/pages/create")).json()) as { body: Array<Record<string, any>> };
      const stage = page.body.find((node) => node.type === "media_stage")!;
      return { pills: (stage.pills as Array<{ label: string }>).map((p) => p.label), errors: (stage.error_actions as Array<{ label: string }>).map((p) => p.label) };
    };
    expect(await labels()).toEqual({ pills: ["Another take", "Edit and make again", "Favorite"], errors: ["Try again", "Change the words"] });
    __setVideoStatusForTests(null);
    expect(await labels()).toEqual({ pills: ["Edit and make again", "Favorite"], errors: ["Change the words"] });
  });

  test("the heart is the Favorite mark: liking a clip shows it liked on the next read, per person", async () => {
    const { adult, other, row } = await household();
    const { fileId } = await makeClip(adult.client, row("Marlow"));
    expect((await action(adult.client, "favorite", { id: fileId, favorite: true })).status).toBe(200);
    expect((await short(adult.client))[0]!.liked).toBe(true);
    await action(adult.client, "share-add", { id: fileId, person_id: other.id });
    expect((await short(other.client))[0]!.liked).toBe(false);
    await action(adult.client, "favorite", { id: fileId, favorite: false });
    expect((await short(adult.client))[0]!.liked).toBe(false);
  });

  test("another adult sees nothing until a clip is shared with them; stopping sharing takes it away", async () => {
    const { adult, other, row } = await household();
    const { fileId } = await makeClip(adult.client, row("Marlow"));
    expect(await short(other.client)).toEqual([]);
    await action(adult.client, "share-add", { id: fileId, person_id: other.id });
    const seen = await short(other.client);
    expect(seen.map((r) => r.id)).toEqual([fileId]);
    expect(seen[0]!.subtitle).toBe("Marlow");
    await action(adult.client, "share-private", { id: fileId });
    expect(await short(other.client)).toEqual([]);
  });

  test("a child sees only what is shared and cleared for them, never the words, and the first row turns autoplay off; a teen's does not", async () => {
    const { adult, child, teen, row } = await household();
    const { fileId } = await makeClip(adult.client, row("Marlow"));
    expect(shortClipRows(row("Sprout"))).toEqual([]);
    // A clip with sound is not released to anyone whose ceiling is below X (its speech was not checked), so the shared clip never reaches the child or the teen.
    await action(adult.client, "share-add", { id: fileId, person_id: child.id });
    await action(adult.client, "share-add", { id: fileId, person_id: teen.id });
    expect(shortClipRows(row("Sprout"))).toEqual([]);
    expect(shortClipRows(row("Nova"))).toEqual([]);
    // A silent clip with a stored G stamp clears the child's G ceiling: it is shared, listed, and the first row says autoplay is off.
    const silent = silentClip(row("Marlow"));
    await action(adult.client, "share-add", { id: silent, person_id: child.id });
    await action(adult.client, "share-add", { id: silent, person_id: teen.id });
    const kid = shortClipRows(row("Sprout"));
    // Whatever the Library lists for the child is what the feed lists: nothing more.
    const library = await (await child.client.get("/api/library?type=video&origin=made")).json() as { items: Array<{ id: string }> };
    expect(kid.map((r) => r.id)).toEqual(library.items.map((i) => i.id).filter((id) => id === silent));
    expect(kid.length).toBeGreaterThan(0);
    for (const r of kid) expect(r.prompt).toBeUndefined();
    expect(kid[0]!.autoplay).toBe(false);
    expect(kid.slice(1).some((r) => "autoplay" in r)).toBe(false);
    const teens = shortClipRows(row("Nova"));
    expect(teens.map((r) => r.id)).toEqual([silent]);
    for (const r of teens) { expect(r.prompt).toBeUndefined(); expect("autoplay" in r).toBe(false); }
  });

  test("a child and a teen reach no other scope of recipes (feed, job, clips, showcase, studio)", async () => {
    const { teen, child } = await household();
    for (const who of [teen, child]) for (const scope of ["feed", "job", "clips", "showcase", "studio", "studio-picker", "header", "stage"]) expect((await who.client.post("/api/plugins/video/data/recipes", { scope, id: "x" })).status).toBe(404);
    // The Clips shelf and page ask for the short scope: open to both.
    for (const who of [teen, child]) expect((await who.client.post("/api/plugins/video/data/recipes", { scope: "short" })).status).toBe(200);
    // VF-UI-02: the Library's film shelves are served to every role, and a teen or child gets no rows (films are adult-only), so the shelves are absent, never a load error.
    for (const who of [teen, child]) for (const scope of ["making-films", "unfinished-films"]) {
      const res = await who.client.post("/api/plugins/video/data/recipes", { scope });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    }
  });

  test.skipIf(!specAllowsClipFeed)("with the Clips page registered, a child and a teen open the short scope and nothing else", async () => {
    const { teen, child } = await household();
    for (const who of [teen, child]) expect((await who.client.post("/api/plugins/video/data/recipes", { scope: "short" })).status).toBe(200);
  });
});

describe("the Clips page", () => {
  const page = JSON.parse(readFileSync(join(PACKAGES_DIR, "video/pages/clips-feed.json"), "utf8")) as { body: Array<Record<string, any>> };
  const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, "video/manifest.json"), "utf8"));
  const node = page.body[0]!;

  test("one clip_feed over the short scope, with the kit's own Close, the heart and Make another", () => {
    expect(page.body).toHaveLength(1);
    expect(node).toMatchObject({
      type: "clip_feed",
      bind: { source: "package", path: "recipes", params: { scope: "short" } },
      item_fields: { src: "src", poster: "poster", title: "title", duration_s: "duration_s", id: "id", subtitle: "subtitle", liked: "liked" },
      autoplay: true,
      autoplay_field: "autoplay",
      on_close: { navigate: { to: "/apps/video" } },
    });
    expect(node.actions.like.call).toMatchObject({ target: "/api/plugins/video/actions/favorite", args: { id: "{id}", favorite: "{liked}" } });
    expect(node.actions.remake).toMatchObject({ starts: "video", navigate: { to: "/apps/video/create", state: { prompt: "{prompt}" } } });
    expect(node.empty_state.text).not.toContain("—");
  });

  test.skipIf(!specAllowsClipFeed)("Clips is in the Videos pages, the play group and a child may open it; the Create group keeps My clips", () => {
    const entry = manifest.contributes.pages.find((p: any) => p.id === "clips-feed");
    expect(entry).toMatchObject({ label: "Clips", nav: true, kind: "schema", module: "clips-feed" });
    expect(entry.min_role).toBeUndefined();
    const groups = manifest.contributes.sidebar.groups;
    expect(groups.find((g: any) => g.id === "play").pages).toContain("clips-feed");
    // My clips lives under Browse, in the Library group; it stays adult-only.
    expect(groups.filter((g: any) => g.mode === "play").some((g: any) => g.pages.includes("clips"))).toBe(true);
    expect(manifest.contributes.pages.find((p: any) => p.id === "clips")).toMatchObject({ min_role: "adult" });
  });

  test.skipIf(!specAllowsClipFeed)("Videos home has a Clips shelf with an Open Clips link beside its heading", () => {
    const index = JSON.parse(readFileSync(join(PACKAGES_DIR, "video/pages/index.json"), "utf8"));
    const shelves: Array<Record<string, any>> = [];
    const walk = (n: unknown): void => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { const o = n as Record<string, any>; if (o.type === "media_shelf") shelves.push(o); Object.values(o).forEach(walk); } };
    walk(index);
    const clips = shelves.find((s) => s.bind?.params?.scope === "short");
    expect(clips).toBeDefined();
    expect(clips!.heading).toBe("Clips");
    expect(clips!.see_all).toMatchObject({ label: "Open Clips", action: { navigate: { to: "/apps/video/clips-feed" } } });
  });
});
