import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations, people, scheduledTasks, toolAudit } from "@/db/schema";
import type { EffectivePermission } from "@/lib/house/access";
import type { HouseArea, HouseEntity } from "@/lib/house/registry";
import { houseToolSpec, planHouseCall, runHouseTool, type HouseToolDeps } from "@/lib/house/tool";
import { createDeviceSchedule } from "@/lib/schedules/store";
import type { PersonRow } from "@/types";
import { fakeHa, HOUSE_SETTINGS } from "../schedules/fakeHa";
import { resetDb } from "../reset-db";

const OWNER = "person-sagetestowner1";
const ADULT = "person-adulttestuser2";
const TEEN = "person-marlowteen0003";
const CHILD = "person-novachild00004";
const NY = "America/New_York";
const areas: HouseArea[] = [{ id: "out", name: "Outside" }, { id: "up", name: "Upstairs", instance: "upstairs" }];
const entity = (id: string, name: string, kind: HouseEntity["kind"], extra: Partial<HouseEntity> = {}): HouseEntity => ({ id, name, kind, area: "out", state: "off", sensitive: null, deviceClass: null, rgb: null, brightness: null, sceneMembers: null, ...extra });
let entities: HouseEntity[] = [];
let ha = fakeHa();

function person(id: string, role: string): void {
  const now = "2026-11-06T00:00:00.000Z";
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:testnode" }).run();
}
const actor = (id: string, role: string) => ({ id, role }) as PersonRow;
const grantAll = (_id: string): EffectivePermission[] => ["porch", "hall"].flatMap((name) => (["see", "control"] as const).map((level) => ({ action: `house.${level}:default/entity:light.${name}`, effect: "allow" as const })));

type Audit = { personId: string; tool: string; action: string; decision: string; band: string; count: number };
function setup(over: Partial<HouseToolDeps> = {}) {
  const audits: Audit[] = [];
  const deps: HouseToolDeps = {
    loadRegistry: async () => ({ ok: true, areas, entities }), permissionsOf: grantAll, brakeMode: () => "do",
    audit: (value) => audits.push(value as Audit), undo: () => ({ id: "undo-1", expiresAt: new Date().toISOString() }),
    schedule: { house: { read: HOUSE_SETTINGS, fetch: ha.fetch }, zoneOf: () => NY, now: () => new Date("2026-11-06T20:00:00.000Z") },
    ...over,
  };
  return { deps, audits };
}
const said = (o: { result?: { reply?: { text?: string } }; userMessage?: string }): string => o.result?.reply?.text ?? o.userMessage ?? "";
const everyDay = { action: "schedule", targets: [{ name: "Porch" }], do: "turn_on", when: { time: "16:00" } };
const plan = (args: Record<string, unknown>, who: { id: string; role: string; band?: "adult" | "teen" | "child" } = { id: OWNER, role: "owner" }, mode: "do" | "ask" | "never" = "do", approved = false) =>
  planHouseCall({ actor: actor(who.id, who.role), band: who.band ?? "adult", args, approved, registry: { ok: true, areas, entities }, permissions: grantAll(who.id), mode, zone: NY });

beforeEach(() => {
  resetDb();
  db.delete(people).run();
  person(OWNER, "owner"); person(ADULT, "adult"); person(TEEN, "teen"); person(CHILD, "child");
  entities = [entity("light.porch", "Porch", "light"), entity("light.hall", "Hall", "light"), entity("lock.front", "Front door", "lock", { sensitive: "lock" }), entity("scene.evening", "Evening", "scene", { sceneMembers: ["light.porch"] })];
  ha = fakeHa();
});

describe("schedule asks first", () => {
  test("the ask names the device, its room and the time in words, and mode do still asks", () => {
    for (const mode of ["do", "ask"] as const) {
      const planned = plan(everyDay, undefined, mode);
      expect(planned.kind).toBe("ask");
      if (planned.kind === "ask") expect(planned.prompt).toBe("Turn on Porch light in Outside every day at 4:00 PM?");
    }
    const weekdays = plan({ ...everyDay, when: { time: "07:30", days: [1, 3] } });
    expect(weekdays.kind === "ask" && weekdays.prompt).toBe("Turn on Porch light in Outside on Mon, Wed at 7:30 AM?");
    const once = plan({ ...everyDay, do: "turn_off", when: { once_at: "2026-11-12T23:00:00.000Z" } });
    expect(once.kind === "ask" && once.prompt).toBe("Turn off Porch light in Outside once on Nov 12 at 6:00 PM?");
  });

  test("more than three devices are named as three and a count", () => {
    entities = ["a", "b", "c", "d", "e"].map((name) => entity(`light.${name}`, name.toUpperCase(), "light"));
    const planned = planHouseCall({ actor: actor(OWNER, "owner"), band: "adult", args: { action: "schedule", targets: [{ area: "Outside" }], do: "turn_on", when: { time: "16:00" } }, registry: { ok: true, areas, entities }, permissions: [], mode: "do", zone: NY });
    expect(planned.kind === "ask" && planned.prompt).toBe("Turn on A light in Outside, B light in Outside, C light in Outside and 2 more every day at 4:00 PM?");
  });

  test("mode never blocks it", () => {
    expect(plan(everyDay, undefined, "never").kind).toBe("refuse");
  });

  test("an unapproved call asks and makes nothing; the approved call makes one automation and says so plainly", async () => {
    const s = setup();
    const asked = await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: everyDay, callId: "call-1", deps: s.deps });
    expect(said(asked)).toBe("Turn on Porch light in Outside every day at 4:00 PM?");
    expect(ha.automations.size).toBe(0);
    const done = await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: everyDay, callId: "resumed:call-1", approved: true, deps: s.deps });
    expect(said(done)).toBe("Done. Porch light turns on every day at 4:00 PM.");
    expect(ha.automations.size).toBe(1);
    expect(db.select().from(scheduledTasks).all().map((row) => JSON.parse(row.what).targets)).toEqual([["default/light.porch"]]);
  });

  test("when Home Assistant cannot take it the reply says Home will run it", async () => {
    ha.state.failWrites = true;
    const done = await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: everyDay, callId: "resumed:call-1", approved: true, deps: setup().deps });
    expect(said(done)).toBe("Done. Porch light turns on every day at 4:00 PM. Home Assistant could not take it, so Home will run it.");
  });
});

describe("who may schedule", () => {
  test("teens, children and unknown speakers get found_nothing and no schedule actions in the spec", async () => {
    for (const [id, role, band] of [[TEEN, "teen", "teen"], [CHILD, "child", "child"]] as const) {
      const out = await runHouseTool({ actor: actor(id, role), band, args: everyDay, callId: "call-1", deps: setup().deps });
      expect((out as { failureKind?: string }).failureKind).toBe("found_nothing");
      for (const action of ["list_schedules", "cancel_schedule"]) {
        const other = await runHouseTool({ actor: actor(id, role), band, args: { action, targets: [{ name: "Porch" }] }, callId: "call-2", deps: setup().deps });
        expect((other as { failureKind?: string }).failureKind).toBe("found_nothing");
      }
      const spec = JSON.stringify(houseToolSpec({ visible: entities, areas, actor: { id, role, band } }));
      for (const word of ["schedule", "list_schedules", "cancel_schedule", "\"do\"", "\"when\""]) expect(spec).not.toContain(word);
    }
    expect(plan(everyDay, { id: "", role: "unknown" }).kind).toBe("refuse");
    expect(ha.automations.size).toBe(0);
  });

  test("an adult sees the three actions and the do and when arguments", () => {
    const spec = houseToolSpec({ visible: entities, areas, actor: { id: ADULT, role: "adult", band: "adult" } });
    const properties = (spec.args as { properties: unknown }).properties as Record<string, { enum?: string[] }>;
    expect(properties.action!.enum).toEqual(expect.arrayContaining(["schedule", "list_schedules", "cancel_schedule"]));
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(["do", "when"]));
  });
});

describe("what cannot be scheduled", () => {
  test("a lock is refused with the reminder offer before any ask", async () => {
    const planned = plan({ action: "schedule", targets: [{ name: "Front door" }], do: "turn_on", when: { time: "22:00" } });
    expect(planned.kind).toBe("refuse");
    if (planned.kind === "refuse") expect(planned.text).toContain("I can set a reminder instead.");
    const out = await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: { action: "schedule", targets: [{ name: "Front door" }], do: "turn_on", when: { time: "22:00" } }, callId: "call-1", deps: setup().deps });
    expect(said(out)).toContain("reminder");
    expect(ha.automations.size).toBe(0);
  });

  test("a scene with a sensitive member is refused with the reminder offer", () => {
    entities = [entity("light.porch", "Porch", "light"), entity("lock.front", "Front door", "lock", { sensitive: "lock" }), entity("scene.evening", "Evening", "scene", { sceneMembers: ["light.porch", "lock.front"] })];
    const planned = plan({ action: "schedule", targets: [{ name: "Evening" }], when: { time: "18:00" } });
    expect(planned.kind).toBe("refuse");
    if (planned.kind === "refuse") expect(planned.text).toContain("reminder");
  });

  test("a bad shape is refused: no cron or free text, brightness needs a value", () => {
    expect(plan({ ...everyDay, when: { cron: "0 16 * * *" } }).kind).toBe("refuse");
    expect(plan({ ...everyDay, when: { time: "4pm" } }).kind).toBe("refuse");
    expect(plan({ ...everyDay, do: "set_brightness" }).kind).toBe("refuse");
    expect(plan({ ...everyDay, when: undefined }).kind).toBe("refuse");
  });
});

describe("list and cancel", () => {
  async function seed(personId: string, role: string, name: string, time: string) {
    const made = await createDeviceSchedule({ person: { id: personId, role }, kind: "device_action", targets: [`default/light.${name}`], action: "turn_on", time, days: [] }, { ...setup().deps.schedule!, loadRegistry: async () => ({ ok: true, areas, entities }), permissionsOf: grantAll });
    if (!made.ok) throw new Error("setup");
    return made.id;
  }
  const call = (who: { id: string; role: string }, args: Record<string, unknown>, deps: HouseToolDeps, approved = args.action !== "list_schedules") => runHouseTool({ actor: actor(who.id, who.role), band: "adult", args, callId: approved ? "resumed:call-1" : "call-1", approved, deps });

  test("list shows only the speaker's own rows; an owner or admin also gets a count of others", async () => {
    const deps = setup({ permissionsOf: () => [...grantAll(""), { action: "house.see:default/entity:light.hall", effect: "allow" }] }).deps;
    await seed(OWNER, "owner", "porch", "16:00");
    await seed(ADULT, "adult", "hall", "07:30");
    const mine = said(await call({ id: OWNER, role: "owner" }, { action: "list_schedules" }, deps));
    expect(mine).toContain("Porch light turns on every day at 4:00 PM");
    expect(mine).not.toContain("Hall");
    expect(mine).toContain("1 schedule belongs to other people.");
    const adult = said(await call({ id: ADULT, role: "adult" }, { action: "list_schedules" }, deps));
    expect(adult).toContain("Hall light");
    expect(adult).not.toContain("Porch");
    expect(adult).not.toContain("other people");
  });

  test("a paused schedule says why in plain words", async () => {
    const id = await seed(OWNER, "owner", "porch", "16:00");
    db.update(scheduledTasks).set({ state: "paused", pausedReason: "grant_revoked" }).where(eq(scheduledTasks.id, id)).run();
    expect(said(await call({ id: OWNER, role: "owner" }, { action: "list_schedules" }, setup().deps))).toContain("paused because you can no longer control the device");
  });

  test("cancel removes only the speaker's own schedule; an owner cannot cancel someone else's by name", async () => {
    await seed(ADULT, "adult", "hall", "07:30");
    const deps = setup().deps;
    const other = await call({ id: OWNER, role: "owner" }, { action: "cancel_schedule", targets: [{ name: "Hall" }] }, deps);
    expect((other as { failureKind?: string }).failureKind).toBe("found_nothing");
    expect(db.select().from(scheduledTasks).all().filter((row) => row.deletedAt === null)).toHaveLength(1);
    const own = await call({ id: ADULT, role: "adult" }, { action: "cancel_schedule", targets: [{ name: "Hall" }] }, deps);
    expect(said(own)).toContain("Cancelled");
    expect(db.select().from(scheduledTasks).all().filter((row) => row.deletedAt === null)).toHaveLength(0);
  });

  test("two schedules on one device are ambiguous and both are named; the time picks one", async () => {
    await seed(OWNER, "owner", "porch", "16:00");
    await seed(OWNER, "owner", "porch", "21:30");
    const deps = setup().deps;
    const asked = await call({ id: OWNER, role: "owner" }, { action: "cancel_schedule", targets: [{ name: "Porch" }] }, deps, false);
    expect(said(asked)).toContain("Porch at 4:00 PM");
    expect(said(asked)).toContain("Porch at 9:30 PM");
    expect(db.select().from(scheduledTasks).all().filter((row) => row.deletedAt === null)).toHaveLength(2);
    await call({ id: OWNER, role: "owner" }, { action: "cancel_schedule", targets: [{ name: "Porch" }], when: { time: "21:30" } }, deps);
    expect(db.select().from(scheduledTasks).all().filter((row) => row.deletedAt === null).map((row) => row.time)).toEqual(["16:00"]);
  });
});

describe("audit and instances", () => {
  test("audit rows hold the action name and result only, with no task, automation, entity or instance text", async () => {
    const s = setup();
    await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: everyDay, callId: "resumed:call-1", approved: true, deps: s.deps });
    await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: { action: "list_schedules" }, callId: "call-2", deps: s.deps });
    await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: { action: "cancel_schedule", targets: [{ name: "Porch" }] }, callId: "resumed:call-3", approved: true, deps: s.deps });
    expect(s.audits.map((audit) => audit.action)).toEqual(["schedule", "list_schedules", "cancel_schedule"]);
    const row = db.select().from(scheduledTasks).get()!;
    const text = JSON.stringify(s.audits.map(({ personId: _owner, ...rest }) => rest)) + JSON.stringify(db.select().from(toolAudit).all().map(({ personId: _p, ...rest }) => rest));
    for (const secret of [row.id, "maipai_", "light.porch", "default/", "Porch", "sched-"]) expect(text).not.toContain(secret);
  });

  test("a schedule on a second instance resolves and stores the namespaced target", async () => {
    const now = "2026-11-06T00:00:00.000Z";
    for (const slug of ["default", "upstairs"]) db.insert(integrations).values({ id: `integ-${slug}00000`, type: "home_assistant", instance: slug, label: slug, address: "http://192.168.1.20:8123", credentialRef: "home.access_token", options: "{}", provenance: "test", createdAt: now, updatedAt: now, hlc: "1:0:testnode" }).run();
    entities = [entity("light.den", "Den", "light", { instance: "upstairs", instanceLabel: "Upstairs", area: "up" }), entity("light.porch", "Porch", "light", { instance: "default", instanceLabel: "Home" })];
    const s = setup({ permissionsOf: () => ["see", "control"].flatMap((level) => ["upstairs/entity:light.den", "default/entity:light.porch"].map((target) => ({ action: `house.${level}:${target}`, effect: "allow" as const }))) });
    const done = await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: { action: "schedule", targets: [{ name: "Den" }], do: "turn_off", when: { time: "23:00" } }, callId: "resumed:call-1", approved: true, deps: s.deps });
    expect(said(done)).toContain("Done. Den light turns off every day at 11:00 PM.");
    expect(db.select().from(scheduledTasks).all().map((row) => JSON.parse(row.what).targets)).toEqual([["upstairs/light.den"]]);
  });
});

// ---- Review fixes (part B, second pass) ----
describe("cancel asks first", () => {
  async function seedAdult(name = "porch", time = "16:00") {
    const made = await createDeviceSchedule({ person: { id: ADULT, role: "adult" }, kind: "device_action", targets: [`default/light.${name}`], action: "turn_on", time, days: [] }, { ...setup().deps.schedule!, loadRegistry: async () => ({ ok: true, areas, entities }), permissionsOf: grantAll });
    if (!made.ok) throw new Error("setup");
    return made.id;
  }
  const planAdult = (args: Record<string, unknown>, mode: "do" | "ask" | "never" = "do", approved = false) => plan(args, { id: ADULT, role: "adult" }, mode, approved);

  test("the card names the device and time; mode do still asks; mode never blocks; approved runs", async () => {
    await seedAdult();
    for (const mode of ["do", "ask"] as const) {
      const planned = planAdult({ action: "cancel_schedule", targets: [{ name: "Porch" }] }, mode);
      expect(planned.kind === "ask" && planned.prompt).toBe("Cancel the Porch light schedule at 4:00 PM?");
    }
    expect(planAdult({ action: "cancel_schedule", targets: [{ name: "Porch" }] }, "never").kind).toBe("refuse");
    expect(planAdult({ action: "cancel_schedule", targets: [{ name: "Porch" }] }, "do", true).kind).toBe("run");
  });

  test("an unapproved cancel, as a page or search result could send it, cancels nothing", async () => {
    await seedAdult();
    const out = await runHouseTool({ actor: actor(ADULT, "adult"), band: "adult", args: { action: "cancel_schedule", targets: [{ name: "Porch" }] }, callId: "call-1", tainted: true, deps: setup().deps });
    expect(said(out)).toBe("Cancel the Porch light schedule at 4:00 PM?");
    expect(db.select().from(scheduledTasks).all().filter((row) => row.deletedAt === null)).toHaveLength(1);
  });

  test("a hidden same-name device in another home neither blocks nor leaks, and a revoked-grant schedule can still be cancelled", async () => {
    await seedAdult();
    entities = [...entities, entity("light.porch", "Porch", "light", { instance: "cabin", instanceLabel: "Cabin" })];
    const planned = planAdult({ action: "cancel_schedule", targets: [{ name: "Porch" }] });
    expect(planned.kind).toBe("ask");
    const none = (): EffectivePermission[] => [];
    const revoked = planHouseCall({ actor: actor(ADULT, "adult"), band: "adult", args: { action: "cancel_schedule", targets: [{ name: "Porch" }] }, registry: { ok: true, areas, entities: entities.slice(0, 4) }, permissions: none(), mode: "do", zone: NY });
    expect(revoked.kind).toBe("ask");
    const ambiguousText = planHouseCall({ actor: actor(OWNER, "owner"), band: "adult", args: { action: "cancel_schedule", targets: [{ name: "Porch" }], instance: "cabin" }, registry: { ok: true, areas, entities }, permissions: none(), mode: "do", zone: NY });
    expect(ambiguousText.kind === "refuse" && ambiguousText.text).not.toContain("Cabin");
  });

  test("a finished schedule cannot be cancelled and is not listed", async () => {
    const id = await seedAdult();
    db.update(scheduledTasks).set({ state: "done" }).where(eq(scheduledTasks.id, id)).run();
    const planned = planAdult({ action: "cancel_schedule", targets: [{ name: "Porch" }] });
    expect(planned.kind).toBe("refuse");
  });
});

describe("the confirm is pinned to what the card showed", () => {
  test("an area-only target is rewritten to one explicit target per device, and a device added later is not included", () => {
    const first = plan({ action: "schedule", targets: [{ area: "Outside", kind: "light" }], do: "turn_on", when: { time: "16:00" } });
    expect(first.kind).toBe("ask");
    if (first.kind !== "ask") return;
    const pinned = first.pinned!;
    expect(pinned.targets).toEqual([{ area: "Outside", name: "Porch", kind: "light" }, { area: "Outside", name: "Hall", kind: "light" }]);
    entities = [...entities, entity("light.garden", "Garden", "light")];
    const resumed = plan(pinned, undefined, "do", true);
    expect(resumed.kind).toBe("run");
    if (resumed.kind === "run") expect(resumed.matches.map((item) => item.id)).toEqual(["light.porch", "light.hall"]);
  });

  test("the policy node parks the pinned arguments, not the model's", async () => {
    const { policyNode } = await import("@/lib/turnMachine/nodes/policy");
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    const { __setHouseRegistryCacheDepsForTests, clearHouseRegistry } = await import("@/lib/house/cache");
    setHouseholdSettingValue("home.base_url", "http://192.168.1.20:8123");
    setHouseholdSettingValue("home.access_token", "test-token");
    clearHouseRegistry();
    const rows = [{ id: "light.porch", name: "Porch", state: "off", area: "out", dc: "", rgb: [], bri: 0, ents: [] }, { id: "light.hall", name: "Hall", state: "off", area: "out", dc: "", rgb: [], bri: 0, ents: [] }];
    __setHouseRegistryCacheDepsForTests({ read: (key) => key === "home.base_url" ? "http://192.168.1.20:8123" : "test-token", fetch: async (_url, init) => new Response(JSON.parse(String(init.body)).template.includes("states") ? JSON.stringify(rows) : JSON.stringify([{ id: "out", name: "Outside" }])) });
    const state = { actor: { id: OWNER, role: "owner" }, surface: "chat", speakerEvidence: { kind: "person" }, context: [], crisis: false, temporary: false, utterance: "x", houseAllowed: true, houseContext: { visible: [], areas } } as never;
    const args: Record<string, unknown> = { action: "schedule", target: { area: "Outside" }, do: "turn_on", when: { time: "16:00" } };
    const out = await policyNode(state, { calls: [{ id: "c1", tool: "house", args }] }, new AbortController().signal);
    clearHouseRegistry();
    const entry = out.output.entries[0]!;
    expect(entry.decision).toMatchObject({ allow: false, reason: "confirm_needed" });
    expect(entry.proposal.request.args).toEqual({ action: "schedule", targets: [{ area: "Outside", name: "Porch", kind: "light" }, { area: "Outside", name: "Hall", kind: "light" }], do: "turn_on", when: { time: "16:00" } });
  });
});

describe("refused before the yes", () => {
  const ok = (args: Record<string, unknown>) => plan({ action: "schedule", targets: [{ name: "Porch" }], do: "turn_on", ...args }).kind;
  test("a once_at without an offset, a date only, a past time, an out of range value and brightness on a non-light are all refused", () => {
    expect(ok({ when: { once_at: "2026-12-12T18:00:00" } })).toBe("refuse");
    expect(ok({ when: { once_at: "2026-12-12" } })).toBe("refuse");
    expect(ok({ when: { once_at: "2020-01-01T18:00:00-05:00" } })).toBe("refuse");
    expect(ok({ when: { once_at: "2035-12-12T18:00:00-05:00" } })).toBe("ask");
    expect(ok({ when: { once_at: "2035-12-12T23:00:00Z" } })).toBe("ask");
    expect(ok({ when: { time: "16:00" }, value: 150 })).toBe("refuse");
    entities = [...entities, entity("switch.lamp", "Lamp", "switch")];
    expect(plan({ action: "schedule", targets: [{ name: "Lamp" }], do: "set_brightness", value: 50, when: { time: "16:00" } }).kind).toBe("refuse");
    expect(plan({ action: "schedule", targets: [{ name: "Porch" }], do: "set_brightness", value: 50, when: { time: "16:00" } }).kind).toBe("ask");
  });
});

describe("the admin count", () => {
  test("counts only other people's active and paused schedules", async () => {
    const mk = (id: string, name: string) => createDeviceSchedule({ person: { id, role: id === OWNER ? "owner" : "adult" }, kind: "device_action", targets: [`default/light.${name}`], action: "turn_on", time: "16:00", days: [] }, { ...setup().deps.schedule!, loadRegistry: async () => ({ ok: true, areas, entities }), permissionsOf: grantAll });
    const mine = await mk(OWNER, "porch");
    const theirs = await mk(ADULT, "hall");
    const gone = await mk(ADULT, "porch");
    if (!mine.ok || !theirs.ok || !gone.ok) throw new Error("setup");
    db.update(scheduledTasks).set({ state: "done" }).where(eq(scheduledTasks.id, gone.id)).run();
    const text = said(await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: { action: "list_schedules" }, callId: "call-1", deps: setup().deps }));
    expect(text).toContain("1 schedule belongs to other people.");
  });
});

describe("rule 6a: refusals and failures record the action name only", () => {
  test("every refusal, failure and ask outcome of the three actions carries {action} and nothing else", async () => {
    const s = setup();
    const outcomes = [
      await runHouseTool({ actor: actor(TEEN, "teen"), band: "teen", args: { ...everyDay, instance: "cabin" }, callId: "c1", deps: s.deps }),
      await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: { action: "schedule", targets: [{ name: "Nope" }], do: "turn_on", when: { time: "16:00" }, instance: "cabin" }, callId: "c2", deps: s.deps }),
      await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: { action: "schedule", targets: [{ name: "Front door" }], do: "turn_on", when: { time: "16:00" } }, callId: "c3", deps: s.deps }),
      await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: everyDay, callId: "c4", deps: s.deps }),
      await runHouseTool({ actor: actor(OWNER, "owner"), band: "adult", args: { action: "cancel_schedule", targets: [{ name: "Porch" }] }, callId: "c5", deps: s.deps }),
    ];
    for (const out of outcomes) expect((out as { args?: unknown }).args).toEqual({ action: expect.any(String) });
    expect(JSON.stringify(outcomes)).not.toContain("cabin");
    expect(JSON.stringify(outcomes.map((out) => (out as { args?: unknown }).args))).not.toContain("Porch");
  });
});
