// ONE-COMPOSER-2026-11-13 (COMPOSER-03): GET /api/composer/modes. A mode is offered only where the same policy functions beginTurn uses
// allow its tool and the page's own floor opens; readiness is the health row's, never a second reading; quality follows the resource tiers.
import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { child, owner, teen } from "./support/testAuth";
import { composerModesFor } from "@/lib/composer/modes";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { __resetMakingHealthForTests } from "@/lib/roleHealth";
import { __resetChatPauseTrackingForTests } from "@/lib/healthSnapshot";
import { __setMusicStatusForTests } from "@/lib/music/ready";
import { roleHealth } from "@/lib/roleHealth";
import { VIDEO_ENABLED_KEY } from "@/lib/videos/policy";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import type { PersonRow } from "@/types";

type Row = { id: string; state: { state: string; reason?: string | null } };
function stack(roles: Row[]) {
  __setStackClientForTests({
    roles: async () => ({ roles }),
    memory: async () => ({ watchdog: { level: "normal", generation_paused: false } }),
    getCodingMode: async () => ({ mode: "normal", target: "normal", state: "stable" }),
  } as never);
}
const all: Row[] = [{ id: "chat", state: { state: "ready" } }, { id: "image", state: { state: "installed" } }, { id: "video", state: { state: "loaded" } }, { id: "tts", state: { state: "ready" } }];

beforeEach(() => { resetDb(); setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770"); __resetMakingHealthForTests(); __resetChatPauseTrackingForTests(); __setMusicStatusForTests(null); });
afterEach(() => { __resetStackEngineForTests(); __resetMakingHealthForTests(); __setMusicStatusForTests(undefined); });

const ids = (r: { modes: Array<{ id: string }> }) => r.modes.map((m) => m.id);

describe("composer modes by band", () => {
  test("an adult is offered Ask, Picture, Video and Song with the page's own slots, chips and words", async () => {
    stack(all);
    const { row } = await owner();
    const res = await composerModesFor(row as PersonRow);
    expect(ids(res)).toEqual(["ask", "picture", "video", "from-picture", "animate", "talking-avatar", "voiceover", "film", "song"]);
    const picture = res.modes.find((m) => m.id === "picture")!;
    expect(picture.route).toBe("/apps/image/create");
    expect(picture.placeholder).toContain("@");
    expect(picture.chips.filter((c) => c.group === "Settings").map((c) => c.id)).toEqual(["shape", "count"]);
    expect(picture.primary.label).toBe("Make picture");
    expect(picture.presets?.chips[0]!.options.length).toBeGreaterThan(0);
    // CREATOR-13: the Presets pill also carries the picture presets as settings (Look by family, Light, Angle, Format), each starting at None.
    expect(picture.presets?.chips.map((c) => c.id)).toEqual(["template", "look_art", "look_story", "look_portrait", "look_product", "look_other", "light", "angle", "format"]);
    expect(picture.presets?.chips.filter((c) => c.id !== "template").every((c) => c.target === "setting" && c.default === "none")).toBe(true);
    expect(picture.presets?.chips[0]!.target).toBe("words");
    expect(res.modes.find((m) => m.id === "video")!.presets?.chips.some((c) => c.target === "setting") ?? false).toBe(false);
    const video = res.modes.find((m) => m.id === "video")!;
    expect(video.route).toBe("/apps/video/create");
    expect(video.chips.filter((c) => c.group === "Settings").map((c) => c.id)).toEqual(["orientation", "seconds"]);
    expect(video.primary.label).toBe("Generate");
    expect(video.availability).toBe("ready");
  });

  test("the video stub pages are modes: two hand the picture to Video Create, three say plainly they are coming soon", async () => {
    stack(all);
    const { row } = await owner();
    const res = await composerModesFor(row as PersonRow);
    const mode = (id: string) => res.modes.find((m) => m.id === id)!;
    expect(mode("from-picture").references.map((r) => r.id)).toEqual(["start_frame"]);
    expect(mode("from-picture").comingSoon).toBeNull();
    expect(mode("animate").comingSoon).toBeNull();
    for (const id of ["talking-avatar", "voiceover", "film"]) {
      expect(mode(id).comingSoon).toMatch(/coming soon\. Until then/);
      expect(mode(id).primary.label.length).toBeGreaterThan(0);
      expect(mode(id).placeholder.length).toBeGreaterThan(0);
    }
    expect(mode("picture").comingSoon).toBeNull();
    expect(mode("video").comingSoon).toBeNull();
  });

  test("a child gets no video mode, and no mode names a model or a resource word", async () => {
    stack(all);
    const { client } = await owner();
    const kid = (await child(client)).row as PersonRow;
    const res = await composerModesFor(kid);
    expect(ids(res)).not.toContain("video");
    expect(ids(res)).not.toContain("song");
    expect(JSON.stringify(res)).not.toMatch(/credit|price|memory|\bRAM\b|model/i);
  });

  test("a teen gets no video-adult extras and no Max quality chip", async () => {
    stack(all);
    const { client } = await owner();
    await teen(client);
    const t = db.select().from(people).where(eq(people.role, "teen")).get()! as PersonRow;
    const res = await composerModesFor(t);
    for (const mode of res.modes) expect(mode.quality?.options.map((o) => o.value) ?? ["standard"]).not.toContain("max");
  });

  test("the household switching video off removes the Video mode (the same policy as the chat tool)", async () => {
    stack(all);
    setHouseholdSettingValue(VIDEO_ENABLED_KEY, false);
    const { row } = await owner();
    expect(ids(await composerModesFor(row as PersonRow))).not.toContain("video");
  });
});

describe("composer modes readiness", () => {
  test("a picture engine that is not installed shows the mode with the health row's own line, never hidden", async () => {
    stack([{ id: "chat", state: { state: "ready" } }, { id: "video", state: { state: "loaded" } }]);
    const { row } = await owner();
    const picture = (await composerModesFor(row as PersonRow)).modes.find((m) => m.id === "picture")!;
    expect(picture.availability).toBe("unavailable");
    expect(picture.disabledReason).toBe("Picture making isn't set up on this computer yet. An owner can add it in Settings, Pictures and videos.");
  });

  test("music and voices readiness are roleHealth reasons with their own lines", async () => {
    stack([{ id: "chat", state: { state: "ready" } }, { id: "tts", state: { state: "notInstalled" } }]);
    expect(await roleHealth("voices")).toMatchObject({ availability: "unavailable", cause: "not_installed" });
    expect(await roleHealth("music")).toMatchObject({ availability: "starting", cause: "restarting" });
    __setMusicStatusForTests({ state: "not-installed", available: false } as never);
    __resetMakingHealthForTests();
    expect(await roleHealth("music")).toMatchObject({ availability: "unavailable", cause: "not_installed" });
    const { collectHealth } = await import("@/lib/healthSnapshot");
    const health = await collectHealth();
    expect(health.engines.music?.notice?.adult).toBe("Song making isn't set up on this computer yet. An owner can add it in Settings, Pictures and videos.");
    expect(health.engines.voices?.notice?.child).toBe("Voices aren't ready yet. Ask a grown-up.");
  });
});
