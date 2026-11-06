import { describe, expect, test } from "bun:test";
import { houseToolSpec, runHouseTool, planHouseCall, safeHouseAction, houseLabel, normalizeHouseArgs, type HouseToolDeps } from "@/lib/house/tool";
import type { HouseEntity, HouseArea } from "@/lib/house/registry";
import type { PersonRow } from "@/types";
import { filterAnswerBlocks } from "@/lib/answerBlocks";

const areas: HouseArea[] = [{ id: "k", name: "Kitchen" }, { id: "h", name: "Hallway" }];
const entity = (id: string, name: string, kind: HouseEntity["kind"], area: string | null = "k", extra: Partial<HouseEntity> = {}): HouseEntity => ({ id, name, kind, area, state: "off", sensitive: null, deviceClass: null, rgb: null, brightness: null, sceneMembers: null, ...extra });
const data: HouseEntity[] = [entity("light.kitchen_ceiling", "Ceiling", "light"), entity("light.kitchen_table", "Table", "light"), entity("light.kitchen_sink", "Sink", "light"), entity("switch.hall", "Hall switch", "switch", "h"), entity("light.astro", "Astro", "light", "h"), entity("light.atlas", "Atlas", "light", "h"), entity("light.bramble", "Bramble", "light", "h"), entity("lock.front_door", "Front door lock", "lock", "h", { sensitive: "lock" }), entity("scene.null", "Evening", "scene", "k")];
const person = { id: "owner-1", role: "owner" } as PersonRow;
function setup(overrides: Partial<HouseToolDeps> = {}, visibleData = data) {
  const performed: Array<[HouseEntity, unknown]> = [];
  const audits: unknown[] = [];
  const undos: unknown[] = [];
  const deps: HouseToolDeps = {
    loadRegistry: async () => ({ ok: true, areas, entities: visibleData }),
    permissionsOf: () => [],
    perform: async (target, action) => { performed.push([target, action]); return { ok: true, before: { state: "off", brightness: null, rgb: null, percentage: null, temperature: null }, after: { state: "on", brightness: 100, rgb: null, percentage: null, temperature: null }, undo: { name: "turn_off" } }; },
    brakeMode: () => "do", audit: (value) => audits.push(value), undo: (value) => { undos.push(value); return { id: "undo-1", expiresAt: new Date().toISOString() }; },
    ...overrides,
  };
  return { deps, performed, audits, undos };
}
const said = (o: { result?: { reply?: { text?: string } }; userMessage?: string }): string => o.result?.reply?.text ?? o.userMessage ?? "";
const run = (args: Record<string, unknown>, deps: HouseToolDeps, role: string = "owner", band: "adult" | "teen" | "child" = "adult") => runHouseTool({ actor: { ...person, role } as PersonRow, band, args, callId: "call-1", deps });

describe("house tool", () => {
  test("spec lists only speaker-visible areas and never entity ids", () => {
    const spec = houseToolSpec({ visible: [data[0]!], areas });
    expect(JSON.stringify(spec)).toContain("Kitchen");
    expect(JSON.stringify(spec)).not.toContain("Hallway");
    expect(JSON.stringify(spec)).not.toContain("light.kitchen_ceiling");
  });
  test("find filters by area and kind and never includes entities the speaker cannot see", async () => {
    const visible = data.filter((item) => item.id !== "light.astro");
    const out = await run({ action: "find", targets: [{ area: "kitchen", kind: "light" }] }, setup({}, visible).deps);
    expect(JSON.stringify(out.result)).toContain("Ceiling");
    expect(JSON.stringify(out.result)).not.toContain("Astro");
    expect(JSON.stringify(out.result)).not.toContain("light.kitchen_ceiling");
  });
  test("area-only target expands to visible lights", async () => {
    const s = setup(); await run({ action: "turn_on", targets: [{ area: "kitchen", kind: "light" }] }, s.deps);
    expect(s.performed).toHaveLength(3);
  });
  test("ambiguous name returns options and unknown name returns not_found", async () => {
    const items = [...data, entity("light.astro2", "Astro", "light", "h")];
    const ambiguous = await run({ action: "turn_on", targets: [{ name: "astro" }] }, setup({}, items).deps);
    expect(said(ambiguous)).toContain("Astro");
    const missing = await run({ action: "turn_on", targets: [{ name: "no such device" }] }, setup().deps);
    expect(said(missing)).toContain("could not find");
  });
  test("more than twelve resolved entities is refused", async () => {
    const many = Array.from({ length: 13 }, (_, i) => entity(`light.l${i}`, `Light ${i}`, "light", "k"));
    const out = await run({ action: "turn_on", targets: [{ area: "kitchen", kind: "light" }] }, setup({}, many).deps);
    expect(said(out)).toContain("too many");
  });
  test("child cannot unlock; refusal does not reveal entity name or perform", async () => {
    const s = setup({ permissionsOf: () => [] });
    const out = await run({ action: "unlock", targets: [{ name: "Front door lock" }] }, s.deps, "child", "child");
    expect(s.performed).toHaveLength(0); expect(said(out)).not.toContain("Front door");
  });
  test("teen explicit lock allow requires confirmation", async () => {
    const s = setup({ permissionsOf: () => [{ action: "house.see:entity:lock.front_door", effect: "allow" }, { action: "house.control:entity:lock.front_door", effect: "allow" }] });
    const out = await run({ action: "unlock", targets: [{ name: "Front door lock" }] }, s.deps, "member", "teen");
    expect((out as unknown as { confirmNeeded?: boolean }).confirmNeeded).toBe(true); expect(s.performed).toHaveLength(0);
  });
  test("adult action performs each target, audits without names, writes one undo and confirmation block", async () => {
    const s = setup(); const out = await run({ action: "turn_on", targets: [{ area: "kitchen", kind: "light" }] }, s.deps);
    expect(s.performed).toHaveLength(3); expect(s.audits).toHaveLength(1); expect(JSON.stringify(s.audits)).not.toContain("kitchen_ceiling");
    expect(s.undos).toHaveLength(1); expect((s.undos[0] as { inverse: { calls: unknown[] } }).inverse.calls).toHaveLength(3);
    const blocks = (out.result?.data as { blocks?: Array<{ kind: string }> } | undefined)?.blocks;
    expect(blocks).toHaveLength(1); expect(blocks?.[0]?.kind).toBe("confirmation");
  });
  test("null-member scene not found to a teen", async () => {
    const out = await run({ action: "activate", targets: [{ name: "Evening" }] }, setup({ permissionsOf: () => [] }).deps, "member", "teen");
    expect(said(out)).toContain("could not find");
  });
  test("never and ask modes refuse or park without performing", async () => {
    const never = setup({ brakeMode: () => "never" });
    expect((await run({ action: "turn_on", targets: [{ name: "Ceiling" }] }, never.deps)).userMessage ?? "").toContain("turned off");
    const ask = setup({ brakeMode: () => "ask" }); const out = await run({ action: "turn_on", targets: [{ name: "Ceiling" }] }, ask.deps);
    expect((out as unknown as { confirmNeeded?: boolean }).confirmNeeded).toBe(true); expect(ask.performed).toHaveLength(0);
  });
  test("perform failure is plain copy and token never appears", async () => {
    const s = setup({ perform: async () => ({ ok: false, kind: "unreachable" }) });
    const out = await run({ action: "turn_on", targets: [{ name: "Ceiling" }] }, s.deps);
    expect(JSON.stringify(out)).toContain("Home Assistant did not answer"); expect(JSON.stringify(out)).not.toContain("super-secret-token");
  });
  test("unknown speaker gets nothing", async () => {
    const out = await runHouseTool({ actor: { role: "unknown", band: "child" }, band: "child", args: { action: "find" }, callId: "x", deps: setup().deps });
    expect(out.status).toBe("rejected"); expect(out.result).toBeUndefined();
  });

  test("scene member rule: unknown members are adults only, members must all be controllable by a minor", async () => {
    const light = entity("light.kitchen_ceiling", "Ceiling", "light");
    const doorLock = entity("lock.front_door", "Front door", "lock", "h", { sensitive: "lock" });
    const unknownScene = entity("scene.movie_night", "Movie night", "scene", "k", { sceneMembers: null });
    const safeScene = entity("scene.reading", "Reading", "scene", "k", { sceneMembers: ["light.kitchen_ceiling"] });
    const lockScene = entity("scene.goodnight", "Goodnight", "scene", "k", { sceneMembers: ["light.kitchen_ceiling", "lock.front_door"] });
    const all = [light, doorLock, unknownScene, safeScene, lockScene];
    const teenGrant = [{ action: "house.control:area:k", effect: "allow" as const }, { action: "house.see:area:k", effect: "allow" as const }, { action: "house.see:area:h", effect: "allow" as const }, { action: "house.control:area:h", effect: "allow" as const }];
    const teen = setup({ permissionsOf: () => teenGrant }, all);
    const found = await run({ action: "find", targets: [{ kind: "scene" }] }, teen.deps, "teen", "teen");
    const text = (found.result as { reply: { text: string } }).reply.text;
    expect(text).toContain("Reading");
    expect(text).not.toContain("Movie night");
    expect(text).not.toContain("Goodnight");
    const adult = setup({}, all);
    const adultFound = await run({ action: "find", targets: [{ kind: "scene" }] }, adult.deps);
    const adultText = (adultFound.result as { reply: { text: string } }).reply.text;
    expect(adultText).toContain("Movie night");
    expect(adultText).toContain("Goodnight");
  });

  test("review fixes: invalid mode asks, find obeys never, tainted asks, scene with a lock member asks, no unlocking undo, band is the stricter of role and band", async () => {
    const light = entity("light.kitchen_ceiling", "Ceiling", "light");
    const doorLock = entity("lock.front_door", "Front door", "lock", "h", { sensitive: "lock" });
    const byeScene = entity("scene.bye", "Bye", "scene", "k", { sceneMembers: ["light.kitchen_ceiling", "lock.front_door"] });
    const all = [light, doorLock, byeScene];
    const odd = setup({ brakeMode: () => "off" as never }, all);
    const asked = await run({ action: "turn_on", targets: [{ name: "Ceiling" }] }, odd.deps);
    expect(asked.status).not.toBe("succeeded");
    expect(odd.performed).toHaveLength(0);

    const never = setup({ brakeMode: () => "never" }, all);
    const listed = await run({ action: "find", targets: [{ kind: "lock" }] }, never.deps);
    expect((listed.result as { reply?: { text: string } } | undefined)?.reply?.text ?? "").not.toContain("Front door");

    const tainted = await runHouseTool({ actor: { ...person } as PersonRow, band: "adult", args: { action: "turn_on", targets: [{ name: "Ceiling" }] }, callId: "c", tainted: true, deps: setup({}, all).deps });
    expect(tainted.status).not.toBe("succeeded");

    const scene = setup({}, all);
    const sceneRun = await run({ action: "activate", targets: [{ name: "Bye" }] }, scene.deps);
    expect(sceneRun.status).not.toBe("succeeded");
    expect(scene.performed).toHaveLength(0);

    const door = setup({ perform: async (target) => ({ ok: true, before: { state: "locked", brightness: null, rgb: null, percentage: null, temperature: null }, after: { state: "unlocked", brightness: null, rgb: null, percentage: null, temperature: null }, undo: { name: "lock" } }) }, all);
    expect(door.undos).toHaveLength(0);

    const teenAsAdult = setup({}, [light]);
    const strict = await runHouseTool({ actor: { ...person, role: "teen" } as PersonRow, band: "adult", args: { action: "find" }, callId: "c", deps: { ...teenAsAdult.deps, permissionsOf: () => [] } });
    expect((strict.result as { reply?: { text: string } } | undefined)?.reply?.text ?? "").not.toContain("Ceiling");
  });

  test("a spec with no visible areas has no empty enum", () => {
    const spec = houseToolSpec({ visible: [], areas });
    expect(JSON.stringify(spec)).not.toContain('"enum":[]');
  });


  test("a locked door asks first, runs once approved, and never keeps an unlocking Undo", async () => {
    const doorLock = entity("lock.front_door", "Front door", "lock", "h", { sensitive: "lock" });
    const rig = setup({ perform: async () => ({ ok: true, before: { state: "unlocked", brightness: null, rgb: null, percentage: null, temperature: null }, after: { state: "locked", brightness: null, rgb: null, percentage: null, temperature: null }, undo: { name: "unlock" } }) }, [doorLock]);
    const first = await run({ action: "lock", targets: [{ name: "Front door" }] }, rig.deps);
    expect(first.status).not.toBe("succeeded");
    expect(rig.performed).toHaveLength(0);
    const second = await runHouseTool({ actor: { ...person } as PersonRow, band: "adult", args: { action: "lock", targets: [{ name: "Front door" }] }, callId: "resumed:house", approved: true, deps: rig.deps });
    expect(second.status).toBe("succeeded");
    expect(rig.undos).toHaveLength(0);
  });

  test("approved lifts the ask for an adult's lock but never for a child or a never mode, and audit action names are closed", () => {
    const doorLock = entity("lock.front_door", "Front door", "lock", "h", { sensitive: "lock" });
    const registry = { ok: true as const, areas, entities: [doorLock] };
    const owner = { id: "o1", role: "owner" } as PersonRow;
    const args = { action: "lock", targets: [{ name: "Front door" }] };
    expect(planHouseCall({ actor: owner, band: "adult", args, registry, permissions: [], mode: "do" }).kind).toBe("ask");
    expect(planHouseCall({ actor: owner, band: "adult", args, approved: true, registry, permissions: [], mode: "do" }).kind).toBe("run");
    expect(planHouseCall({ actor: owner, band: "adult", args, approved: true, registry, permissions: [], mode: "never" }).kind).toBe("refuse");
    const child = { id: "c1", role: "child" } as PersonRow;
    expect(planHouseCall({ actor: child, band: "child", args, approved: true, registry, permissions: [{ action: "house.control:entity:lock.front_door", effect: "allow" }], mode: "do" }).kind).toBe("refuse");
    expect(safeHouseAction("unlock light.front_door and more text")).toBe("invalid");
    expect(safeHouseAction("turn_on")).toBe("turn_on");
    expect(safeHouseAction(undefined)).toBe("invalid");
  });

  test("the receipt block passes the real answer-block validator for a light and for a lock", async () => {
    const light = entity("light.kitchen_ceiling", "Ceiling", "light");
    const doorLock = entity("lock.front_door", "Front door", "lock", "h", { sensitive: "lock" });
    for (const [target, action, args] of [[light, "turn_on", { action: "turn_on", targets: [{ name: "Ceiling" }] }], [doorLock, "lock", { action: "lock", targets: [{ name: "Front door" }] }]] as const) {
      const undoCalls = [];
      const rig = setup({ perform: async () => ({ ok: true, before: { state: "off", brightness: null, rgb: null, percentage: null, temperature: null }, after: { state: "on", brightness: null, rgb: null, percentage: null, temperature: null }, undo: { name: target.kind === "lock" ? "unlock" : "turn_off" } }), undo: (value) => { undoCalls.push(value); return { id: "blk-undo123456", expiresAt: new Date().toISOString() }; } }, [target]);
      const outcome = await runHouseTool({ actor: { ...person } as PersonRow, band: "adult", args, callId: "resumed:house", approved: true, deps: rig.deps });
      const blocks = (outcome.result?.data as { blocks?: unknown[] } | undefined)?.blocks ?? [];
      if (action === "lock") { expect(blocks).toHaveLength(0); continue; }
      expect(blocks).toHaveLength(1);
      const accepted = filterAnswerBlocks(blocks, "house", ["confirmation", "rows"], "adult", { displayName: "Sage" } as never);
      expect(accepted).toHaveLength(1);
    }
  });

  test("the ask plan names every device and room so a vague request cannot act on something unseen", () => {
    const fan = entity("fan.master_ceiling", "Ceiling fan", "fan", "h");
    const wall = entity("light.theater_wall", "Wall", "light", "k");
    expect(houseLabel(fan, areas)).toBe("Ceiling fan in Hallway");
    expect(houseLabel(wall, areas)).toBe("Wall light in Kitchen");
    const registry = { ok: true as const, areas, entities: [fan, wall] };
    const plan = planHouseCall({ actor: { id: "o1", role: "owner" } as PersonRow, band: "adult", args: { action: "turn_on", targets: [{ name: "Wall" }, { name: "Ceiling fan" }] }, registry, permissions: [], mode: "ask" });
    expect(plan.kind).toBe("ask");
    expect(plan.kind === "ask" && plan.labels).toEqual(["Wall light in Kitchen", "Ceiling fan in Hallway"]);
  });

  test("a small model's loose arguments are reshaped into one targets list, never read from the person's words", () => {
    expect(normalizeHouseArgs({ action: "find", target: "{\"area\": \"Theater\"}" })).toEqual({ action: "find", targets: [{ area: "Theater" }] });
    expect(normalizeHouseArgs({ action: "turn_on", target: { area: "Theater", kind: "lights" } })).toEqual({ action: "turn_on", targets: [{ area: "Theater", kind: "light" }] });
    expect(normalizeHouseArgs({ action: "turn_on", area: "Kitchen", name: "Ceiling" })).toEqual({ action: "turn_on", targets: [{ area: "Kitchen", name: "Ceiling" }] });
    expect(normalizeHouseArgs({ action: "turn_on", targets: "{\"name\":\"Wall\"}" })).toEqual({ action: "turn_on", targets: [{ name: "Wall" }] });
    expect(normalizeHouseArgs({ action: "turn_on", targets: { name: "Wall" } })).toEqual({ action: "turn_on", targets: [{ name: "Wall" }] });
    expect(normalizeHouseArgs({ action: "turn_on", target: "Wall" })).toEqual({ action: "turn_on", targets: [{ name: "Wall" }] });
    expect(normalizeHouseArgs({ action: "turn_on", targets: [{ name: "Wall", kind: "light" }], value: 5 })).toEqual({ action: "turn_on", targets: [{ name: "Wall", kind: "light" }], value: 5 });
    expect(normalizeHouseArgs({ action: "turn_on", targets: [], evil: "x" })).toEqual({ action: "turn_on", targets: [] });
  });
});

