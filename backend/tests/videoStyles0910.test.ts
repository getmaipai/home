// VIDEO-LORA-09 and -10 (docs/design/video-loras-2026-11-02.md 6): styles on Create and in chat. The prompt plan table is in promptPlan.test.ts; this file is the
// route, the tool-name resolution and the tool description (redaction), the adult-only mark and the level rules, on real records and a fake Stack.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetAdultLockForTests, __unlockedForTests } from "@/lib/adultLock";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLoraSyncForTests } from "@/lib/loras/sync";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { LORAS_UNSUPPORTED_LINE } from "@/lib/videos/loraWire";
import { LOCKED_START_LINE } from "@/lib/videos/lock";
import { STYLE_GONE_LINE, listableStyleNames, resolveStyles } from "@/lib/videos/styleChoice";
import { withStyleList } from "@/lib/videos/styleToolSpec";
import { bodyOfVideoJob, makeAudienceOf } from "@/lib/videos/make";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { TWO_CHARACTERS_LINE } from "@/lib/videos/promptPlan";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { household, unlock, unlockHeader } from "./fixtures/adultLock";
import { putLora, secretLora } from "./fixtures/lora";
import { editVideoArgs } from "@/lib/videos/editTool";
import type { StackVideoLora } from "@/lib/videos/stack";
import type { Lora } from "@/lib/loras/store";
import type { PersonRow } from "@/types";

setDefaultTimeout(30_000);
let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetLoraSyncForTests(); __resetAdultLockForTests(); __resetThrottleForTests();
  fake = installFakeVideoStack();
  fake.loras = [];
});
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

/** The Stack lists a file for each record (the sync keeps records in step with the Stack's files). */
function stackHas(...records: Lora[]): void {
  fake.loras = records.map((r): StackVideoLora => ({ id: r.id, name: r.name, sha256: r.file.sha256, bytes: 1000, base_model: r.base_model as never, licence: "MIT", source_url: null, classification: r.audience, trigger_words: r.trigger_words, strength_default: r.strength.default, added_at: r.added_at }));
}
/** A Stack with LTX-2.5 and Max ready; `maxLoras` and `stdLoras` say which of them report LoRA support. */
function engine(opts: { max?: boolean; std?: boolean; nag?: boolean }): void {
  const status = readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready", detailed: "installed" });
  const loras = (supported: boolean) => ({ supported, max: 2, mode: "unfused" as const, negative_prompt: opts.nag ? ("nag" as const) : ("none" as const) });
  status.qualities!.ltx25!.loras = loras(opts.std === true);
  status.qualities!.ltx25max!.loras = loras(opts.max === true);
  __setVideoStatusForTests(status);
}
const STYLE = { base_model: "ltx-2.5", compatible_with: ["ltx-2.5"], availability: { who: "adults", people: [] } } as Partial<Lora>;
const WORDS = "A paper boat floats down a rainy street";

describe("POST /api/videos/make with styles (Create)", () => {
  test("a Max clip with a style: words kept, trigger first, add-ins after, strength clamped, loras carry the file identity", async () => {
    const { owner, row } = await household();
    const clay = putLora(row("Sage").id, { ...STYLE, name: "Clay look", trigger_words: ["claymation"], positive_addins: ["soft studio light"], strength: { default: 1, min: 0.2, max: 1.5 } });
    stackHas(clay); engine({ max: true });
    const res = await owner.post("/api/videos/make", { prompt: WORDS, tier: "max", styles: [clay.id], strength: "more" });
    expect(res.status).toBe(200);
    const sent = fake.submitted[0]! as { prompt: string; loras: Array<{ id: string; strength: number; sha256: string }>; model: string };
    expect(sent.model).toBe("ltx25-max");
    expect(sent.prompt).toBe(`claymation, ${WORDS}, soft studio light`);
    expect(sent.loras).toEqual([{ id: clay.id, strength: 1.25, sha256: clay.file.sha256 }]);
    const job = getVideoJobFor(row("Sage"), ((await res.json()) as { id: string }).id)!;
    expect(job.prompt).toBe(WORDS); // the card keeps only what they typed
    expect(job.request.loras).toEqual([clay.id]);
    expect(job.request.create?.strength).toBe("more");
  });

  test("a level the Stack does not report LoRA-capable refuses with one plain line and starts nothing", async () => {
    const { owner, row } = await household();
    const clay = putLora(row("Sage").id, { ...STYLE });
    stackHas(clay); engine({ max: true, std: false });
    const res = await owner.post("/api/videos/make", { prompt: WORDS, tier: "standard", styles: [clay.id] });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(LORAS_UNSUPPORTED_LINE);
    expect(fake.submitted).toHaveLength(0);
  });

  test("a level the Stack reports LoRA-capable accepts a style on Standard too", async () => {
    const { owner, row } = await household();
    const clay = putLora(row("Sage").id, { ...STYLE, trigger_words: ["claymation"] });
    stackHas(clay); engine({ max: true, std: true });
    expect((await owner.post("/api/videos/make", { prompt: WORDS, tier: "standard", styles: [clay.id] })).status).toBe(200);
    expect((fake.submitted[0] as { model: string; prompt: string }).model).toBe("ltx25-q8");
  });

  test("a client id is never trusted: an unknown id, an admins-only style and a removed one answer the same line", async () => {
    const { adult, row } = await household();
    const adminOnly = putLora(row("Sage").id, { ...STYLE, availability: { who: "admins", people: [] } });
    const gone = putLora(row("Sage").id, { ...STYLE, removed_at: "2026-11-02T00:00:00.000Z", trash_until: "2026-12-02T00:00:00.000Z" });
    stackHas(adminOnly, gone); engine({ max: true, std: true });
    const bodies: string[] = [];
    for (const id of [adminOnly.id, gone.id, "lora-doesnotexist000"]) {
      const res = await adult.client.post("/api/videos/make", { prompt: WORDS, tier: "standard", styles: [id] });
      expect(res.status).toBe(422);
      bodies.push(JSON.stringify(await res.json()));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain(STYLE_GONE_LINE);
    expect(fake.submitted).toHaveLength(0);
  });

  test("two character styles are refused; a third style is refused by the route itself", async () => {
    const { owner, row } = await household();
    const a = putLora(row("Sage").id, { ...STYLE, kind: "character" });
    const b = putLora(row("Sage").id, { ...STYLE, kind: "character" });
    const c = putLora(row("Sage").id, { ...STYLE });
    stackHas(a, b, c); engine({ max: true });
    const two = await owner.post("/api/videos/make", { prompt: WORDS, tier: "max", styles: [a.id, b.id] });
    expect(two.status).toBe(422);
    expect(((await two.json()) as { error: string }).error).toBe(TWO_CHARACTERS_LINE);
    expect((await owner.post("/api/videos/make", { prompt: WORDS, tier: "max", styles: [a.id, b.id, c.id] })).status).toBe(400); // the route refuses a third before anything is read
    expect(fake.submitted).toHaveLength(0);
  });

  test("an adult-only style is locked without a proof, and with one the clip is made adult-only (make.ts and adultStyle.ts decide, not the page)", async () => {
    const { owner, row } = await household();
    const adult = secretLora(row("Sage").id, { ...STYLE, availability: { who: "adults", people: [] }, audience: "adult-only" });
    stackHas(adult); engine({ max: true });
    const locked = await owner.post("/api/videos/make", { prompt: WORDS, tier: "max", styles: [adult.id] });
    expect(locked.status).toBe(403);
    expect(((await locked.json()) as { error: string }).error).toBe(LOCKED_START_LINE);
    expect(fake.submitted).toHaveLength(0);
    const proof = await unlock(owner, "correcthorse");
    const open = await owner.post("/api/videos/make", { prompt: WORDS, tier: "max", styles: [adult.id] }, unlockHeader(proof));
    expect(open.status).toBe(200);
    const job = getVideoJobFor(row("Sage"), ((await open.json()) as { id: string }).id)!;
    expect(job.request.adultOnly).toBe(true);
  });

  test("another take keeps the clip's styles and strength; a style that is gone stops it with the plain line", async () => {
    const { owner, row } = await household();
    const clay = putLora(row("Sage").id, { ...STYLE });
    stackHas(clay); engine({ max: true });
    const made = (await (await owner.post("/api/videos/make", { prompt: WORDS, tier: "max", styles: [clay.id], strength: "less" })).json()) as { id: string };
    const job = getVideoJobFor(row("Sage"), made.id)!;
    expect(bodyOfVideoJob(job)).toMatchObject({ styles: [clay.id], strength: "less", tier: "max" });
  });

  test("no styles on a Stack without LoRA support changes nothing (a plain clip is made as before)", async () => {
    const { owner } = await household();
    engine({});
    expect((await owner.post("/api/videos/make", { prompt: WORDS, tier: "max" })).status).toBe(200);
    expect((fake.submitted[0] as { loras?: unknown }).loras).toBeUndefined();
  });
});

describe("chat tools: names, never ids", () => {
  const audienceOf = (p: PersonRow) => makeAudienceOf(p);

  test("a name resolves to the person's own record; an unknown or ambiguous name matches none", async () => {
    const { row } = await household();
    const clay = putLora(row("Sage").id, { ...STYLE, name: "Clay look" });
    putLora(row("Sage").id, { ...STYLE, name: "Ink wash one" });
    putLora(row("Sage").id, { ...STYLE, name: "Ink wash two" });
    stackHas(clay);
    const got = await resolveStyles({ audience: audienceOf(row("Sage")), names: ["the clay look style", "ink wash", "nonsense"] });
    expect(got.ok && got.adapters.map((a) => a.id)).toEqual([clay.id]);
    expect(got.ok && got.unmatched).toEqual(["ink wash", "nonsense"]);
  });

  test("an id typed as a name does not reach a style the person may not use", async () => {
    const { row } = await household();
    const hidden = putLora(row("Sage").id, { ...STYLE, availability: { who: "admins", people: [] } });
    const got = await resolveStyles({ audience: audienceOf(row("Marlow")), names: [hidden.id, hidden.name] });
    expect(got.ok && got.adapters).toEqual([]);
  });

  test("an adult-only style is found only by a name the person typed, and locked until they unlock", async () => {
    const { row } = await household();
    const adult = secretLora(row("Sage").id, { ...STYLE, availability: { who: "adults", people: [] }, name: "Zebraquill Cabaret Lace" });
    const owner = audienceOf(row("Sage"));
    const notTyped = await resolveStyles({ audience: owner, names: ["Zebraquill Cabaret Lace"], utterance: "make me a clip of a boat" });
    expect(notTyped).toEqual({ ok: true, adapters: [], unmatched: ["Zebraquill Cabaret Lace"] });
    const typed = await resolveStyles({ audience: owner, names: ["Zebraquill Cabaret Lace"], utterance: "make a clip in the Zebraquill Cabaret Lace style" });
    expect(typed).toEqual({ ok: false, locked: true });
    // With a live proof the typed name resolves.
    const resolved = await __unlockedForTests(row("Sage").id, () => resolveStyles({ audience: owner, names: ["Zebraquill Cabaret Lace"], utterance: "in the Zebraquill Cabaret Lace style" }));
    expect(resolved.ok && resolved.adapters[0]!.id).toBe(adult.id);
  });

  test("the tool description lists only all-ages styles the caller may use; adult-only, unknown and unmarked names never appear; minors get none", async () => {
    const { row } = await household();
    putLora(row("Sage").id, { ...STYLE, name: "Clay look" });
    putLora(row("Sage").id, { ...STYLE, name: "Admins only look", availability: { who: "admins", people: [] } });
    putLora(row("Sage").id, { ...STYLE, name: "Mystery base look", base_model: "unknown", compatible_with: [] });
    putLora(row("Sage").id, { ...STYLE, name: "A name that is far too long to list" });
    secretLora(row("Sage").id, { ...STYLE, availability: { who: "adults", people: [] }, name: "Zebraquill Cabaret Lace" });
    expect(listableStyleNames(audienceOf(row("Marlow")))).toEqual(["Clay look"]);
    expect(listableStyleNames(audienceOf(row("Sage")))).toEqual(["Admins only look", "Clay look"]);
    expect(listableStyleNames(audienceOf(row("Nova")))).toEqual([]);
    expect(listableStyleNames(audienceOf(row("Sprout")))).toEqual([]);
    expect(listableStyleNames({ ...audienceOf(row("Marlow")), spoken: true })).toEqual([]);
    expect(listableStyleNames({ ...audienceOf(row("Marlow")), surfaceClass: "glance" as never })).toEqual([]);
  });

  test("withStyleList writes the names into the styles argument, and removes styles and strength when there are none to name", async () => {
    const { row } = await household();
    putLora(row("Sage").id, { ...STYLE, name: "Clay look" });
    const manifest = await import("../packages/generate_video/manifest.json");
    const spec = { id: "generate_video", description: "x", args: (manifest as { default?: { args: unknown } }).default?.args ? (manifest as unknown as { default: { args: unknown } }).default.args : (manifest as unknown as { args: unknown }).args };
    const state = (p: PersonRow) => ({ actor: p, surface: "chat", speakerEvidence: undefined, deviceId: null, planBasis: { surfaceClass: "written" }, plan: undefined }) as never;
    const withNames = withStyleList({ ...spec, args: spec.args } as never, state(row("Marlow"))).args as { properties: Record<string, { description?: string }> };
    expect(withNames.properties.styles!.description).toContain("Clay look");
    expect(withNames.properties.strength).toBeDefined();
    const none = withStyleList({ ...spec, args: spec.args } as never, state(row("Nova"))).args as { properties: Record<string, unknown> };
    expect(none.properties.styles).toBeUndefined();
    expect(none.properties.strength).toBeUndefined();
    expect(JSON.stringify(none)).not.toContain("Clay look");
  });
});

describe("edit_video arguments", () => {
  test("styles and strength are names and a word; three styles, an empty name and a made-up strength are refused", () => {
    const ok = { clip: "latest", change: "remix" as const };
    expect(editVideoArgs.safeParse({ ...ok, styles: ["Clay look"], strength: "more" }).success).toBe(true);
    expect(editVideoArgs.safeParse({ ...ok, styles: [] }).success).toBe(true);
    expect(editVideoArgs.safeParse({ ...ok, styles: ["a", "b", "c"] }).success).toBe(false);
    expect(editVideoArgs.safeParse({ ...ok, styles: [""] }).success).toBe(false);
    expect(editVideoArgs.safeParse({ ...ok, strength: "extreme" }).success).toBe(false);
  });
});

describe("the Create page's style picker (served chips)", () => {
  type Chip = { state: string; label: string; options: Array<{ value: string; label: string; note?: string }>; locked?: boolean; enabled_tiers?: string[]; disabled_reason?: string; group?: string };
  function barOf(body: Array<Record<string, any>>): Record<string, any> | undefined {
    for (const node of body) { if (node.type === "prompt_bar") return node; const hit = barOf([...(node.main ?? []), ...(node.aside ?? [])]); if (hit) return hit; }
    return undefined;
  }
  const chipsOf = async (client: { get: (p: string, h?: Record<string, string>) => Promise<Response> }, headers?: Record<string, string>): Promise<Chip[]> => {
    const page = (await (await client.get("/api/plugins/videos/pages/create", headers)).json()) as { body: Array<Record<string, any>> };
    return barOf(page.body)!.chips as Chip[];
  };

  test("no styles and none locked: no style chips at all, and the other five chips are as before", async () => {
    const { owner } = await household();
    engine({ max: true });
    expect((await chipsOf(owner)).map((c) => c.state)).toEqual(["orientation", "seconds", "look", "camera", "voices"]);
  });

  test("Styles and Characters are two groups in the Style popover; Characters is absent when empty; the note shows what a card adds", async () => {
    const { owner, row } = await household();
    const clay = putLora(row("Sage").id, { ...STYLE, name: "Clay look", description: "Looks like clay stop motion.", trigger_words: ["claymation"], positive_addins: ["soft studio light"] });
    stackHas(clay); engine({ max: true });
    let chips = await chipsOf(owner);
    expect(chips.map((c) => c.state)).toEqual(["orientation", "seconds", "look", "camera", "voices", "style", "strength"]);
    const style = chips.find((c) => c.state === "style")!;
    expect(style.group).toBe("Style");
    expect(style.options.map((o) => o.label)).toEqual(["No style", "Clay look"]);
    expect(style.options[1]!.note).toBe("Looks like clay stop motion. Added for Clay look (2 phrases): claymation, soft studio light.");
    expect(style.locked).toBeUndefined();
    expect((style as unknown as { private?: boolean }).private).toBe(true);
    const hero = putLora(row("Sage").id, { ...STYLE, name: "Rover the dog", kind: "character", availability: { who: "adults", people: [] } });
    stackHas(clay, hero);
    chips = await chipsOf(owner);
    expect(chips.map((c) => c.state)).toEqual(["orientation", "seconds", "look", "camera", "voices", "style", "character", "strength"]);
    expect(chips.find((c) => c.state === "character")!.options.map((o) => o.label)).toEqual(["No character", "Rover the dog"]);
  });

  test("enabled only at the levels the Stack reports LoRA-capable, with one plain line elsewhere (never a raw error after a click)", async () => {
    const { owner, row } = await household();
    const clay = putLora(row("Sage").id, { ...STYLE });
    stackHas(clay);
    engine({ max: true });
    let style = (await chipsOf(owner)).find((c) => c.state === "style")!;
    expect(style.enabled_tiers).toEqual(["max"]);
    expect(style.disabled_reason).toBe("Styles work at Max. Choose that level to use one.");
    engine({ max: true, std: true });
    style = (await chipsOf(owner)).find((c) => c.state === "style")!;
    expect(style.enabled_tiers).toEqual(expect.arrayContaining(["standard", "max"]));
    engine({});
    style = (await chipsOf(owner)).find((c) => c.state === "style")!;
    expect(style.enabled_tiers).toBeUndefined();
    expect(style.disabled_reason).toBe("Styles can't be used on this computer yet.");
  });

  test("a person who is not offered Max sees why, in one line; an adult-only style is one lock tile with no name until the unlock", async () => {
    const { adult, owner, row } = await household();
    const open = putLora(row("Sage").id, { ...STYLE, name: "Clay look" });
    const hidden = secretLora(row("Sage").id, { ...STYLE, availability: { who: "adults", people: [] }, audience: "adult-only" });
    stackHas(open, hidden); engine({ max: true });
    const forAdult = await chipsOf(adult.client);
    const style = forAdult.find((c) => c.state === "style")!;
    expect(style.enabled_tiers).toBeUndefined();
    expect(style.disabled_reason).toContain("Styles are for Max for now.");
    expect(style.locked).toBe(true);
    expect(JSON.stringify(forAdult)).not.toContain("Zebraquill");
    expect(JSON.stringify(forAdult)).not.toContain(hidden.id);
    // Unlocked: the real card, no tile.
    const proof = await unlock(owner, "correcthorse");
    const open2 = (await chipsOf(owner, unlockHeader(proof))).find((c) => c.state === "style")!;
    expect(open2.locked).toBeUndefined();
    expect(open2.options.map((o) => o.label)).toContain("Zebraquill Cabaret Lace");
  });

  test("only the owner's own adult-only access draws it: a teen and a child get no style chips (the page is for adults)", async () => {
    const { teen, child, row } = await household();
    stackHas(putLora(row("Sage").id, { ...STYLE }));
    engine({ max: true });
    for (const who of [teen, child]) expect((await who.client.get("/api/plugins/videos/pages/create")).status).not.toBe(200);
  });
});
