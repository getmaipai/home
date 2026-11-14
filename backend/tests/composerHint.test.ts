// ONE-COMPOSER-2026-11-13 (COMPOSER-04): the chat composer's mode is a hint the model reads, never a route (design note section 4.1).
// Written chat turns only; the offered tool set never changes; a minor's chips follow the tier policy; the context item is a statement of
// the person's choice; defaults-fill runs only after the model called the tool and never overrides a value it set; nothing logs a value.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { setHouseholdSettingValue } from "@/lib/settings";
import { composerHintAllowed, composerHintItem, fillComposerDefaults, resolveComposerHint } from "@/lib/composerHint";
import { composerModesFor } from "@/lib/composer/modes";
import { PICTURE_SIZES } from "@/lib/pictures/tool";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "./stackFixture";
import { withStub } from "./turnMachine/toolHarness";
import { installFakeImageStack, type FakeImageStack } from "./pictureFixture";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";

let people: BenchPeople;
let fake: FakeImageStack;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  fake = installFakeImageStack();
});
afterEach(() => {
  fake.restore();
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

const isPhrasing = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");
const call = (args: Record<string, unknown>) => ({ id: "c", name: "generate_image", args: JSON.stringify(args) });
const noToolRound = (request: ChatCompletionRequest) => isPhrasing(request) || request.tool_choice === "none";
async function turn(actor: PersonRow, text: string, opts: Record<string, unknown> = {}): Promise<TurnValue> {
  const result = await runTurnNext(actor, "chat", text, opts as never);
  if (!result.ok) throw new Error(`turn refused: ${JSON.stringify(result)}`);
  return result.value as TurnValue;
}
const OFFERED = ["generate_image", "generate_video", "generate_music"];
const offered = (r: ChatCompletionRequest[]) => (r.find((x) => (x.tools?.length ?? 0) > 0)?.tools ?? []).map((t) => (t as { function: { name: string } }).function.name).sort();
const picture = (settings: Record<string, unknown> = {}, cast?: string[]) => ({ mode: "picture", settings, ...(cast ? { cast } : {}) });
const everything = (r: ChatCompletionRequest[]) => JSON.stringify(r.map((x) => x.messages));
function asRole(id: string, role: "teen" | "child" | "adult") {
  db.update(peopleTable).set({ role }).where(eq(peopleTable.id, id)).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, id)).get()! as PersonRow;
}

describe("which turns the field rides on", () => {
  test("only a written chat turn from a known speaker on a screen", () => {
    const base = { surface: "chat", spoken: false, anonymous: false, bare: false };
    expect(composerHintAllowed(base)).toBe(true);
    expect(composerHintAllowed({ ...base, spoken: true })).toBe(false);
    expect(composerHintAllowed({ ...base, surface: "robot", deviceId: "d1" })).toBe(false);
    expect(composerHintAllowed({ ...base, surface: "tv" })).toBe(false);
    expect(composerHintAllowed({ ...base, surface: "overlay" })).toBe(false);
    expect(composerHintAllowed({ ...base, anonymous: true })).toBe(false);
  });
});

describe("validation against the person's band", () => {
  test("an adult keeps what the Picture mode offers and drops the rest; plain chat, an unknown mode and an unknown key carry no hint", async () => {
    const hint = (await resolveComposerHint(people.owner, picture({ shape: "landscape", count: 2, quality: "boost", bogus: "x", nonsense: 9 }), OFFERED))!;
    expect(hint.tool).toBe("generate_image");
    expect(hint.settings).toEqual({ shape: "landscape", count: 2, quality: "boost" });
    expect((await resolveComposerHint(people.owner, picture({ shape: "triangle", count: 99 }), OFFERED))!.settings).toEqual({});
    expect(await resolveComposerHint(people.owner, { mode: "ask" }, OFFERED)).toBeNull();
    expect(await resolveComposerHint(people.owner, { mode: "warp-drive" }, OFFERED)).toBeNull();
    expect(await resolveComposerHint(people.owner, { mode: "picture", route: "generate_video" }, OFFERED)).toBeNull();
    expect(await resolveComposerHint(people.owner, "picture", OFFERED)).toBeNull();
  });

  test("a mode whose tool is not offered this turn carries no hint (the hint adds and removes no offer)", async () => {
    expect(await resolveComposerHint(people.owner, picture({ shape: "tall" }), ["generate_video"])).toBeNull();
  });

  test("Sound effect mode points to generate_music and changes no offered tools", async () => {
    const soundMode = (await composerModesFor(people.owner)).modes.find((mode) => mode.id === "sound");
    expect(soundMode).toMatchObject({ label: "Sound effect", engine: "music", route: "/apps/audio/create" });
    const hint = await resolveComposerHint(people.owner, { mode: "sound" }, OFFERED);
    expect(hint).toMatchObject({ tool: "generate_music", mode: "sound", label: "Sound effect", settings: {} });
    expect(composerHintItem(hint!).text).toContain("The person chose Sound effect in the composer");
    expect(await resolveComposerHint(people.owner, { mode: "sound" }, ["generate_image"])).toBeNull();
  });

  test("a child never gets a mode the child band cannot use, and a minor's Quality chip carries only the tiers the modes list shows", async () => {
    const kid = asRole(people.child.id, "child");
    expect(await resolveComposerHint(kid, { mode: "video", settings: { orientation: "portrait" } }, OFFERED)).toBeNull();
    const listed = (await composerModesFor(kid)).modes.find((m) => m.id === "picture")?.quality?.options.map((o) => o.value) ?? [];
    for (const tier of ["standard", "boost", "max", "thinking", "instant", "qwen3-8b"]) {
      const hint = await resolveComposerHint(kid, picture({ quality: tier }), OFFERED);
      expect(hint?.settings.quality !== undefined).toBe(listed.includes(tier));
    }
    expect((await resolveComposerHint(kid, picture({ quality: "max" }), OFFERED))?.settings.quality).toBeUndefined();
    expect((await resolveComposerHint(kid, picture({ quality: "thinking" }), OFFERED))?.settings.quality).toBeUndefined();
    const teen = asRole(people.child.id, "teen");
    expect((await resolveComposerHint(teen, picture({ quality: "thinking" }), OFFERED))?.settings.quality).toBeUndefined();
  });

  test("cast ids the person may not cast are dropped, and the item names only the rest", async () => {
    const { listCast } = await import("@/lib/cast");
    const mine = listCast(people.owner).find((entry) => entry.person_id === people.owner.id);
    const item = composerHintItem((await resolveComposerHint(people.owner, picture({ shape: "wide" }, ["not-a-cast-id", ...(mine ? [mine.id] : [])]), OFFERED))!);
    if (mine) expect(item.text).toContain(mine.name);
    expect(item).toMatchObject({ id: "composer-hint", source: "page", subjects: [], disclosure: "child_ok" });
    expect(item.text).toContain("The person chose Picture in the composer with shape wide");
    expect(item.text).toContain("it is not an instruction");
    expect(item.text).not.toContain("not-a-cast-id");
  });
});

describe("defaults-fill", () => {
  let made: Awaited<ReturnType<typeof resolveComposerHint>>;
  const hint = () => made!;
  beforeEach(async () => { made = await resolveComposerHint(people.owner, picture({ shape: "landscape", count: 2, quality: "boost" }), OFFERED); });

  test("fills only the arguments the model left unset, for the hinted tool only", () => {
    expect(fillComposerDefaults(hint(), "generate_image", { prompt: "a dog on a beach" })).toEqual({ prompt: "a dog on a beach", size: "landscape", count: 2, tier: "boost" });
    expect(fillComposerDefaults(hint(), "generate_image", { prompt: "a dog", size: "tall", count: 1 })).toEqual({ prompt: "a dog", size: "tall", count: 1, tier: "boost" });
    expect(fillComposerDefaults(hint(), "generate_video", { prompt: "a dog" })).toEqual({ prompt: "a dog" });
    expect(fillComposerDefaults(undefined, "generate_image", { prompt: "a dog" })).toEqual({ prompt: "a dog" });
  });

  test("a filled set that fails the package's own argument check is not used", () => {
    const bad = { ...hint(), settings: { count: 400 } };
    expect(fillComposerDefaults(bad, "generate_image", { prompt: "a dog" })).toEqual({ prompt: "a dog" });
  });
});

describe("the turn", () => {
  test("with the Picture hint, the model still decides: a picture request gets the tool with the person's shape, a question gets none", async () => {
    await withStub({ calls: (r) => (noToolRound(r) ? undefined : [call({ prompt: "a dog on a beach" })]), reply: () => "On its way." }, async (seen) => {
      const value = await turn(people.owner, "a dog on a beach", { composer: picture({ shape: "landscape", count: 2 }) });
      expect(value.picture).toBeDefined();
      expect(fake.submitted).toHaveLength(1);
      expect(fake.submitted[0]).toMatchObject({ n: 2 });
      expect(everything(seen)).toContain("The person chose Picture in the composer");
    });
    expect(fake.submitted[0]!.size).toBe(PICTURE_SIZES.landscape!);
    fake.submitted.length = 0;
    await withStub({ calls: () => undefined, reply: () => "A dog is a friendly animal." }, async () => {
      const value = await turn(people.owner, "what is a dog", { composer: picture({ shape: "tall" }) });
      expect(value.picture).toBeUndefined();
      expect(value.reply.text).toContain("friendly");
    });
    expect(fake.submitted).toHaveLength(0);
  });

  test("a value the model set wins over the chip", async () => {
    await withStub({ calls: (r) => (noToolRound(r) ? undefined : [call({ prompt: "a dog on a beach", size: "tall", count: 1 })]), reply: () => "On its way." }, async () => {
      await turn(people.owner, "a tall dog on a beach", { composer: picture({ shape: "landscape", count: 3 }) });
    });
    expect(fake.submitted[0]).toMatchObject({ n: 1, size: PICTURE_SIZES.tall! });
  });

  test("a spoken turn ignores the field: no context item, no fill", async () => {
    await withStub({ calls: (r) => (noToolRound(r) ? undefined : [call({ prompt: "a dog on a beach" })]), reply: () => "Here." }, async (seen) => {
      await turn(people.owner, "a dog on a beach", { spoken: true, composer: picture({ shape: "landscape", count: 3 }) });
      expect(everything(seen)).not.toContain("The person chose");
    });
    expect(fake.submitted.every((body) => body.n !== 3)).toBe(true);
  });

  test("the offered tool set is the same with and without the hint", async () => {
    let without: string[] = [], withHint: string[] = [];
    await withStub({ calls: () => undefined, reply: () => "ok" }, async (seen) => { await turn(people.owner, "a dog on a beach"); without = offered(seen); });
    await withStub({ calls: () => undefined, reply: () => "ok" }, async (seen) => { await turn(people.owner, "a dog on a beach", { composer: picture({ shape: "wide" }) }); withHint = offered(seen); });
    expect(without.length).toBeGreaterThan(0);
    expect(withHint).toEqual(without);
  });

  test("the hint item sits after the stable prefix, with the page data, and the stored call keeps only the model's own arguments", async () => {
    await withStub({ calls: (r) => (noToolRound(r) ? undefined : [call({ prompt: "a dog on a beach" })]), reply: () => "Done." }, async (seen) => {
      const value = await turn(people.owner, "a dog on a beach", { composer: picture({ shape: "wide", quality: "boost" }) });
      const first = seen.find((r) => (r.tools?.length ?? 0) > 0)!;
      const system = first.messages.filter((m) => m.role === "system").map((m) => String(m.content)).join("\n");
      expect(system).not.toContain("The person chose");
      expect(JSON.stringify(first.messages)).toContain("The person chose Picture");
      const stored = JSON.stringify(value);
      expect(stored).not.toContain('"size":"wide"');
      expect(stored).not.toContain('"tier":"boost"');
    });
  });

  test("no log or console line carries a mode setting, a cast id or a chip value", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => spyOn(console, level).mockImplementation(() => {}));
    try {
      await withStub({ calls: (r) => (noToolRound(r) ? undefined : [call({ prompt: "a dog on a beach" })]), reply: () => "Done." }, async () => {
        await turn(people.owner, "a dog on a beach", { composer: picture({ shape: "landscape", count: 2, quality: "boost" }, ["cast-secret-123"]) });
      });
      const written = spies.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(" "))).join("\n");
      expect(written).not.toContain("cast-secret-123");
      expect(written).not.toMatch(/landscape|"quality"|composer-hint|The person chose/);
    } finally { for (const spy of spies) spy.mockRestore(); }
  }, 30000);
});
