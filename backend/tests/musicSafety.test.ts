import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { householdAllowsMusic, musicDenial, musicsAllowed, refuseMusicPrompt, MUSIC_REFUSAL_LINE, type MusicAudience } from "@/lib/music/policy";
import { musicAudienceOf, musicRefusalFor, runGenerateMusic, runEditMusic } from "@/lib/music/tool";
import { __setMusicStatusForTests } from "@/lib/music/ready";
import { setHouseholdSettingValue } from "@/lib/settings";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import { installFakeMusicStack, musicState } from "./musicFixture";
let people: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => { resetDb(); people = createBenchPeople(); fake = installFakeMusicStack(); });
afterEach(() => fake.restore());
const audience = (actor = people.owner, over: Partial<MusicAudience> = {}): MusicAudience => ({ actor, band: "adult", surface: "chat", surfaceClass: "written", spoken: false, ...over });
describe("the music age and surface gate", () => {
  test("owner, admin and adult can make music, with a separate default-on household switch", () => {
    for (const role of ["owner", "admin", "adult"] as const) expect(musicsAllowed(audience({ ...people.owner, role }))).toBe(true);
    setHouseholdSettingValue("generation.adults", false);
    setHouseholdSettingValue("generation.video.enabled", false);
    expect(musicDenial(audience())).toBeNull();
    setHouseholdSettingValue("generation.music.enabled", false);
    expect(musicDenial(audience())).toBe("household_off");
  });
  test("a failed setting read uses the default without allowing a minor", () => {
    const unreadable = () => { throw new Error("unreadable"); };
    expect(householdAllowsMusic(unreadable)).toBe(true);
    expect(musicDenial(audience(people.child))).toBe("minor");
  });
  test("children, teens and guests cannot, even with a caller claiming the adult band", () => {
    for (const role of ["child", "teen", "guest"] as const) {
      const actor = { ...people.child, role };
      expect(musicDenial(audience(actor))).toBe(role === "guest" ? "guest" : "minor");
    }
    expect(musicDenial(audience(people.owner, { band: "teen" }))).toBe("minor");
  });
  test("the picture lanes that open pictures to teens and children never open music", () => {
    // Owner ruling 2026-10-17 lets a teen make pictures and a child make cartoons (kid lane on by default); music stays adults only.
    setHouseholdSettingValue("generation.kids", true);
    for (const role of ["child", "teen"] as const) {
      const actor = { ...people.child, role };
      expect(musicDenial(audience(actor, { band: role }))).toBe("minor");
    }
  });
  test("spoken, glance, shared TV, robot, pod and phone surfaces cannot", () => {
    expect(musicDenial(audience(people.owner, { spoken: true }))).toBe("spoken");
    expect(musicDenial(audience(people.owner, { surfaceClass: "glance" }))).toBe("shared_screen");
    expect(musicDenial(audience(people.owner, { surface: "tv" }))).toBe("shared_screen");
    for (const surface of ["robot", "pod", "phone"] as const) expect(musicDenial(audience(people.owner, { surface }))).toBe("spoken");
  });
});
describe("the absolute lines before a job exists", () => {
  test("the one minor list checks description, lyrics and title, including words split across fields", async () => {
    const state = musicState(people.owner, true);
    for (const field of ["description", "lyrics", "title"]) {
      const args = { description: "a folk song", [field]: "sexual content about children" };
      expect(musicRefusalFor(musicAudienceOf(state, false), args)?.why).toBe("minor_sexual");
      const result = await runGenerateMusic({ state, args, callId: "c", spoken: false });
      expect(result.result?.reply?.text).toContain(MUSIC_REFUSAL_LINE.minor_sexual);
    }
    expect(musicRefusalFor(audience(), { description: "children", lyrics: "sexual" })?.why).toBe("minor_sexual");
    expect(fake.submitted).toHaveLength(0);
    expect(refuseMusicPrompt("a song about children making pancakes")).toBeNull();
    expect(refuseMusicPrompt("a sexy song about adults")).toBeNull();
  });
  test("a real voice flag refuses generation and every edit, with no singer-name word list", async () => {
    expect(refuseMusicPrompt("an original folk voice", { imitatesRealVoice: true })).toBe("real_voice");
    for (const run of [runGenerateMusic, runEditMusic]) {
      const result = await run({ state: musicState(people.owner, true), args: { description: "a jazz song", track: "latest", change: "remake", imitates_real_voice: true }, callId: "v", spoken: false });
      expect(result.result?.reply?.text).toContain(MUSIC_REFUSAL_LINE.real_voice);
    }
    expect(fake.submitted).toHaveLength(0);
  });
  test("the policy node refuses forged calls for both tools when gated, including the voice and minor lines", async () => {
    for (const tool of ["generate_music", "edit_music"]) {
      const state = musicState(people.owner, true);
      state.musicAllowed = false; state.musicEditAllowed = false;
      let result = await policyNode(state, { calls: [{ id: "c", tool, args: { description: "a folk tune" } }] }, new AbortController().signal);
      expect(result.output.entries[0]?.decision).toEqual({ allow: false, reason: "music_not_here" });
      state.musicAllowed = true; state.musicEditAllowed = true;
      for (const [args, reason] of [[{ description: "a folk tune", imitates_real_voice: true }, "music_refused_voice"], [{ lyrics: "naked child" }, "music_refused_minor"]] as const) {
        result = await policyNode(state, { calls: [{ id: "c", tool, args }] }, new AbortController().signal);
        expect(result.output.entries[0]?.decision).toEqual({ allow: false, reason });
      }
      db.update(peopleTable).set({ role: "teen" }).where(eq(peopleTable.id, state.actor.id)).run();
      state.actor = { ...state.actor, role: "teen" };
      result = await policyNode(state, { calls: [{ id: "c", tool, args: { description: "a song" } }] }, new AbortController().signal);
      expect(result.output.entries[0]?.decision).toEqual({ allow: false, reason: "music_not_here" });
    }
    expect(fake.submitted).toHaveLength(0);
  });
  test("missing engine fails as unavailable without a Stack submit", async () => {
    __setMusicStatusForTests(null);
    const result = await runGenerateMusic({ state: musicState(people.owner, true), args: { description: "a folk song" }, callId: "c", spoken: false });
    expect(result.status).toBe("failed"); expect(result.failureKind).toBe("unavailable"); expect(fake.submitted).toHaveLength(0);
  });
});
