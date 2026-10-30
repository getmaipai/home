// ENGINE-STATUS-MEDIA-01 (RULES.md S6, "Pictures and video are not ready"): the health row says in advance whether a picture or a
// clip can be started, from the Stack's role list, its memory watchdog and its mode, and a refusal with figures never reaches a person.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests, stackRefusal } from "@/lib/stackEngine";
import { roleHealth, __resetMakingHealthForTests } from "@/lib/roleHealth";
import { collectHealth, __resetChatPauseTrackingForTests } from "@/lib/healthSnapshot";
import { makingNotice } from "@/lib/failureCopy";
import { __setPicturesFetchForTests, submitGeneration, StackPicturesError } from "@/lib/pictures/stack";
import { __setVideosFetchForTests, submitVideo, StackVideoError } from "@/lib/videos/stack";
import { plainFailure } from "@/lib/pictures/jobStore";
import { plainVideoFailure } from "@/lib/videos/jobs";

type RoleRow = { id: string; state: { state: string; reason?: string | null }; reason?: string | null };
function stack(opts: { roles?: RoleRow[]; rolesFail?: boolean; paused?: boolean; coding?: boolean }) {
  __setStackClientForTests({
    roles: async () => { if (opts.rolesFail) throw new Error("offline"); return { roles: opts.roles ?? [] }; },
    memory: async () => ({ watchdog: { level: opts.paused ? "critical" : "normal", generation_paused: opts.paused === true } }),
    getCodingMode: async () => ({ mode: opts.coding ? "coding" : "normal", target: "normal", state: "stable" }),
  } as never);
}
const installed: RoleRow[] = [{ id: "chat", state: { state: "ready" } }, { id: "image", state: { state: "installed" } }, { id: "video", state: { state: "loaded" } }];
const RAW = "This computer is low on memory (53.6 GB available, 10.2 GB kept in reserve), so picture and video making is paused until it recovers. Close big apps, or try again in a minute.";
const FIGURE = /\d+(\.\d+)?\s?(GB|MB|%)/i;

beforeEach(() => { resetDb(); setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770"); __resetMakingHealthForTests(); __resetChatPauseTrackingForTests(); });
afterEach(() => { __resetStackEngineForTests(); __setPicturesFetchForTests(null); __setVideosFetchForTests(null); __resetMakingHealthForTests(); });

describe("picture and video health rows", () => {
  test("ready when the Stack has both roles installed and memory is normal", async () => {
    stack({ roles: installed });
    expect(await roleHealth("image")).toEqual({ availability: "ready", reason: null });
    expect(await roleHealth("video")).toEqual({ availability: "ready", reason: null });
    const health = await collectHealth();
    expect(health.engines.image).toMatchObject({ availability: "ready", alive: true });
    expect(health.engines.image?.notice).toBeUndefined();
  });

  test("starting with cause restarting while the Stack is restarting", async () => {
    stack({ rolesFail: true });
    expect(await roleHealth("image")).toMatchObject({ availability: "starting", cause: "restarting" });
    const video = (await collectHealth()).engines.video!;
    expect(video).toMatchObject({ availability: "starting", cause: "restarting" });
    expect(video.notice?.adult).toBe("The video engine is restarting. Videos will be back by themselves in a minute.");
  });

  test("unavailable with cause memory while the watchdog pauses generation, and the line has no figures", async () => {
    stack({ roles: installed, paused: true });
    expect(await roleHealth("image")).toMatchObject({ availability: "unavailable", cause: "memory" });
    const health = await collectHealth();
    for (const row of [health.engines.image!, health.engines.video!]) {
      expect(row).toMatchObject({ availability: "unavailable", cause: "memory", alive: false });
      for (const line of [row.notice!.adult, row.notice!.teen, row.notice!.child]) expect(line).not.toMatch(FIGURE);
    }
    expect(health.engines.image!.notice!.adult).toContain("low on memory");
    // A paused generator is not a broken hub: `ok` still reads only chat, embed, background and voice.
    expect(health.ok).toBe(health.engines.chat.alive !== false && health.engines.embed.alive !== false && health.engines.background.alive !== false && health.engines.voice.alive !== false && health.sidecars.every((s) => s.status !== "unhealthy" && s.status !== "crashed"));
  });

  test("not_installed outranks the memory pause", async () => {
    stack({ roles: [{ id: "image", state: { state: "notInstalled" } }], paused: true });
    expect(await roleHealth("image")).toMatchObject({ availability: "unavailable", cause: "not_installed" });
    expect(await roleHealth("video")).toMatchObject({ availability: "unavailable", cause: "not_installed" });
    const image = (await collectHealth()).engines.image!;
    expect(image.reason).toBe("not_installed");
    expect(image.notice?.child).toBe("Pictures aren't ready yet. Ask a grown-up.");
  });

  test("coding mode reads unavailable with cause mode_change", async () => {
    stack({ roles: installed, coding: true });
    expect(await roleHealth("video")).toMatchObject({ availability: "unavailable", cause: "mode_change" });
  });

  test("a remembered memory refusal outranks a role list that says ready, and an accepted call forgets it", async () => {
    stack({ roles: installed });
    __setPicturesFetchForTests((async () => Response.json({ error: RAW, code: "no_memory" }, { status: 503 })) as unknown as typeof fetch);
    const error = await submitGeneration({ prompt: "a fox" } as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StackPicturesError);
    expect((error as Error).message).not.toMatch(FIGURE);
    expect(stackRefusal("image")?.kind).toBe("memory");
    expect(await roleHealth("image")).toMatchObject({ availability: "unavailable", cause: "memory" });
    __setPicturesFetchForTests((async () => Response.json({ job: "j1" }, { status: 202 })) as unknown as typeof fetch);
    await submitGeneration({ prompt: "a fox" } as never);
    expect(await roleHealth("image")).toEqual({ availability: "ready", reason: null });
  });
});

describe("a refusal with figures never reaches a person", () => {
  test("picture and video errors, and the lines built from them, carry no figures", async () => {
    stack({ roles: installed });
    for (const code of ["no_memory", "out_of_memory", "admission", "stack_restarting"]) {
      __setPicturesFetchForTests((async () => Response.json({ error: RAW, code }, { status: 503 })) as unknown as typeof fetch);
      __setVideosFetchForTests((async () => Response.json({ error: RAW, code }, { status: 503 })) as unknown as typeof fetch);
      const picture = await submitGeneration({ prompt: "a fox" } as never).catch((e: unknown) => e) as StackPicturesError;
      const video = await submitVideo({ prompt: "a fox" } as never).catch((e: unknown) => e) as StackVideoError;
      for (const line of [picture.message, video.message, plainFailure(picture), plainVideoFailure(video)]) expect(line).not.toMatch(FIGURE);
    }
  });

  test("every making line is free of figures for every band and cause", () => {
    for (const kind of ["image", "video"] as const) for (const availability of ["starting", "unavailable"] as const) {
      for (const cause of [null, "restarting", "memory", "not_installed", "mode_change", "offline"] as const) {
        const notice = makingNotice(kind, availability, cause)!;
        for (const line of [notice.adult, notice.teen, notice.child]) { expect(line).not.toMatch(FIGURE); expect(line).not.toContain("—"); }
      }
    }
    expect(makingNotice("image", "ready", "memory")).toBeNull();
  });
});
