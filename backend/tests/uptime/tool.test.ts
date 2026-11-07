import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { fetchKumaStatus } from "@/lib/uptime/kuma";
import { runUptimeTool, uptimeAllowed, uptimeToolSpec, type UptimeToolDeps } from "@/lib/uptime/tool";
import { resetDb } from "../reset-db";
import { fakeKumaFetch, kumaBody, kumaInstance } from "./helpers";

beforeEach(() => resetDb());

const main = kumaInstance("main", "Main", "192.168.1.20");
const failover = kumaInstance("failover", "Failover", "192.168.1.21");
const mainBody = kumaBody([["Media", [[1, "Plex", 1, 1], [2, "Immich", 1, 0.999], [3, "Router", 1, 1]]]]);
const failoverBody = kumaBody([["Edge", [[1, "Gateway", 0, 0.5], [2, "Plex mirror", 0, 0.25], [3, "DNS", 1, 1]]]]);
const adult = { id: "p-adult", role: "owner" as const };

function deps(instances: ReturnType<typeof kumaInstance>[], hosts: Parameters<typeof fakeKumaFetch>[0], audit: UptimeToolDeps["audit"] = () => {}): UptimeToolDeps {
  const { fetch } = fakeKumaFetch(hosts);
  return { instances: () => instances, fetchStatus: (instance) => fetchKumaStatus(instance, { fetch }), audit };
}
const run = (args: Record<string, unknown>, d: UptimeToolDeps, who = adult, band = "adult") => runUptimeTool({ actor: who, band, args, callId: "c1", deps: d });
const text = (outcome: Awaited<ReturnType<typeof run>>) => outcome.result?.reply?.text ?? outcome.userMessage ?? "";

describe("uptime tool, results", () => {
  test("status with one instance has no label at all", async () => {
    const outcome = await run({ action: "status" }, deps([main], { "192.168.1.20": mainBody }));
    expect(outcome.status).toBe("succeeded");
    expect(text(outcome)).toBe("All 3 up");
    expect(text(outcome)).not.toContain("Main");
  });

  test("status with one instance names what is down", async () => {
    const outcome = await run({ action: "status" }, deps([failover], { "192.168.1.21": failoverBody }));
    expect(text(outcome)).toBe("2 down: Gateway, Plex mirror; 1 up");
  });

  test("status with two instances is one labelled line each", async () => {
    const outcome = await run({ action: "status" }, deps([main, failover], { "192.168.1.20": mainBody, "192.168.1.21": failoverBody }));
    expect(text(outcome).split("\n")).toEqual(["Main: all 3 up", "Failover: 2 down: Gateway, Plex mirror; 1 up"]);
  });

  test("list rows carry the instance label only with two instances", async () => {
    const one = await run({ action: "list" }, deps([main], { "192.168.1.20": mainBody }));
    expect(text(one)).toContain("Plex: up, 100% in 24 hours");
    expect(text(one)).not.toContain("Main");
    const two = await run({ action: "list" }, deps([main, failover], { "192.168.1.20": mainBody, "192.168.1.21": failoverBody }));
    expect(text(two)).toContain("Plex: up, 100% in 24 hours, Main");
    expect(text(two)).toContain("Gateway: down, 50% in 24 hours, Failover");
  });

  test("one instance down is named plainly and does not fail the other", async () => {
    const outcome = await run({ action: "status" }, deps([main, failover], { "192.168.1.20": mainBody, "192.168.1.21": { down: true } }));
    expect(outcome.status).toBe("succeeded");
    expect(text(outcome)).toContain("Main: all 3 up");
    expect(text(outcome)).toContain("The Failover Kuma did not answer.");
  });

  test("every instance failing is unavailable", async () => {
    const outcome = await run({ action: "list" }, deps([main, failover], { "192.168.1.20": { down: true }, "192.168.1.21": { down: true } }));
    expect(outcome.status).toBe("failed");
    expect(outcome.failureKind).toBe("unavailable");
    expect(text(outcome)).toContain("The Main Kuma did not answer.");
  });

  test("an instance with no status page is told apart from one that is down", async () => {
    const bare = kumaInstance("bare", "Bare", "192.168.1.22", null);
    const outcome = await run({ action: "status" }, deps([main, bare], { "192.168.1.20": mainBody }));
    expect(text(outcome)).toContain("The Bare Kuma has no status page set up.");
  });

  test("name filters by substring on the monitor name, across instances", async () => {
    const d = deps([main, failover], { "192.168.1.20": mainBody, "192.168.1.21": failoverBody });
    const list = await run({ action: "list", name: "plex" }, d);
    expect(text(list).split("\n")).toEqual(["Plex: up, 100% in 24 hours, Main", "Plex mirror: down, 25% in 24 hours, Failover"]);
    const status = await run({ action: "status", name: "gate" }, d);
    expect(text(status)).toBe("Failover: 1 down: Gateway");
  });

  test("a name that matches nothing is found_nothing", async () => {
    const outcome = await run({ action: "list", name: "zzz" }, deps([main], { "192.168.1.20": mainBody }));
    expect(outcome.status).toBe("failed");
    expect(outcome.failureKind).toBe("found_nothing");
  });

  test("the instance argument narrows; an unknown one and no instances at all are found_nothing", async () => {
    const d = deps([main, failover], { "192.168.1.20": mainBody, "192.168.1.21": failoverBody });
    expect(text(await run({ action: "status", instance: "main" }, d))).toBe("All 3 up");
    expect((await run({ action: "status", instance: "nope" }, d)).failureKind).toBe("found_nothing");
    expect((await run({ action: "status" }, deps([], {}))).failureKind).toBe("found_nothing");
  });

  test("bad arguments are bad_arguments", async () => {
    const d = deps([main], { "192.168.1.20": mainBody });
    for (const args of [{}, { action: "restart" }, { action: "status", extra: 1 }, { action: "status", name: "" }]) {
      const outcome = await run(args, d);
      expect(outcome.failureKind).toBe("bad_arguments");
    }
  });

  test("a teen, a child and a guest get nothing even if the call reaches the tool", async () => {
    const d = deps([main], { "192.168.1.20": mainBody });
    expect((await run({ action: "status" }, d, { id: "p", role: "teen" as never }, "teen")).status).toBe("rejected");
    expect((await run({ action: "status" }, d, { id: "p", role: "child" as never }, "child")).status).toBe("rejected");
    expect((await run({ action: "status" }, d, { id: "p", role: "guest" as never }, "adult")).status).toBe("rejected");
  });
});

describe("uptime tool, the argument list", () => {
  test("no instance argument with one instance, a closed enum with two", () => {
    expect(JSON.stringify(uptimeToolSpec([main]).args)).not.toContain("instance");
    const two = uptimeToolSpec([failover, main]).args as { properties: { instance: { enum: string[]; description: string } } };
    expect(two.properties.instance.enum).toEqual(["failover", "main"]);
    expect(two.properties.instance.description).toContain("failover is Failover");
    expect(two.properties.instance.description).toContain("main is Main");
  });
});

describe("uptime offer gate", () => {
  const written = { surfaceClass: "written", spoken: false, bare: false };
  function addKuma(slug = "main", enabled = true): void {
    const stamp = "2026-11-06T00:00:00.000Z";
    db.insert(integrations).values({ id: `integ-kuma-${slug}`, type: "uptime_kuma", instance: slug, label: slug, address: "http://192.168.1.20:3001", credentialRef: "", options: JSON.stringify({ status_page: "family" }), enabled, deletedAt: null, provenance: "admin", createdAt: stamp, updatedAt: stamp, hlc: "1:0:testnode" }).run();
  }

  test("nothing is offered when no Kuma instance exists, not even to an adult", () => {
    expect(uptimeAllowed({ actor: { role: "owner" }, band: "adult", ...written })).toBe(false);
  });

  test("a disabled instance does not count", () => {
    addKuma("off", false);
    expect(uptimeAllowed({ actor: { role: "owner" }, band: "adult", ...written })).toBe(false);
  });

  test("adults get it; teens, children, guests and unknown speakers do not", () => {
    addKuma();
    for (const role of ["owner", "admin", "adult"] as const) expect(uptimeAllowed({ actor: { role }, band: "adult", ...written })).toBe(true);
    expect(uptimeAllowed({ actor: { role: "teen" }, band: "teen", ...written })).toBe(false);
    expect(uptimeAllowed({ actor: { role: "child" }, band: "child", ...written })).toBe(false);
    expect(uptimeAllowed({ actor: { role: "guest" }, band: "adult", ...written })).toBe(false);
    expect(uptimeAllowed({ actor: { role: "owner" }, band: "unknown", ...written })).toBe(false);
    expect(uptimeAllowed({ actor: { role: "adult" }, band: "teen", ...written })).toBe(false);
  });

  test("not on a spoken, bare or robot turn", () => {
    addKuma();
    expect(uptimeAllowed({ actor: { role: "owner" }, band: "adult", surfaceClass: "spoken", spoken: true, bare: false })).toBe(false);
    expect(uptimeAllowed({ actor: { role: "owner" }, band: "adult", ...written, bare: true })).toBe(false);
    expect(uptimeAllowed({ actor: { role: "owner" }, band: "adult", ...written, surface: "robot" })).toBe(false);
  });

  test("the options column round trips as a string map", async () => {
    const { listInstances } = await import("@/lib/connectors/instances");
    addKuma();
    expect(listInstances("uptime_kuma")[0]!.options).toEqual({ status_page: "family" });
  });
});

describe("uptime audit (condition C3)", () => {
  test("the audit call carries the action name and result only, never a slug, label or monitor name", async () => {
    const calls: unknown[] = [];
    const d = deps([main, failover], { "192.168.1.20": mainBody, "192.168.1.21": failoverBody }, (input) => { calls.push(input); });
    await run({ action: "list", name: "plex", instance: "main" }, d);
    await run({ action: "status" }, d);
    await run({ action: "status", instance: "nope" }, d);
    await run({ action: "bogus", name: "Gateway" }, d);
    expect(calls.length).toBe(4);
    const dump = JSON.stringify(calls);
    for (const secret of ["main", "failover", "Main", "Failover", "Plex", "plex", "Gateway", "Immich", "DNS", "nope", "uptime_kuma", "192.168"]) expect(dump).not.toContain(secret);
    expect(calls[0]).toMatchObject({ tool: "uptime", action: "list", decision: "do", band: "adult" });
    expect(calls[3]).toMatchObject({ tool: "uptime", action: "invalid", decision: "never" });
  });

  test("the outcome keeps only the action in its recorded arguments", async () => {
    const outcome = await run({ action: "list", name: "Plex", instance: "main" }, deps([main, failover], { "192.168.1.20": mainBody, "192.168.1.21": failoverBody }));
    expect(outcome.args).toEqual({ action: "list" });
    const failed = await run({ action: "list", name: "Plex", extra: true }, deps([main], { "192.168.1.20": mainBody }));
    expect(JSON.stringify(failed.args)).not.toContain("Plex");
  });
});
