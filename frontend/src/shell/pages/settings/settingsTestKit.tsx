// APP-SET-02: shared fixtures for the settings area tests (a test helper, not
// shipped): the real spec registry, a recording fetch, and a signed-in person
// of any role.
import { mock } from "bun:test";
import registryJson from "@maipai/spec/settings/keys.json";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { Roster } from "@/lib/api";

export const REGISTRY = registryJson as unknown as SettingsKey[];

export function makePerson(role: Roster["role"], overrides: Partial<Roster> = {}): Roster & { age_band: "child" | "teen" | "adult" } {
  const band = role === "child" ? "child" : role === "teen" ? "teen" : "adult";
  return {
    id: `person-${role}`,
    display_name: role[0]!.toUpperCase() + role.slice(1),
    nickname: null,
    role,
    avatar_seed: `person-${role}`,
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
    age_band: band,
    ...overrides,
  } as Roster & { age_band: "child" | "teen" | "adult" };
}

export interface HomeFixture {
  /** Every request the page made, as `METHOD url`. */
  requests: string[];
  /** The `scope=` of every settings values request. */
  scopes: string[];
  /** Every settings write, as the page sent it. */
  puts: Array<{ scope: string; key: string; value: unknown }>;
  restore: () => void;
}

export function mockHome({ robots = false, wakeword = false, hasChild = false }: { robots?: boolean; wakeword?: boolean; hasChild?: boolean } = {}): HomeFixture {
  const original = globalThis.fetch;
  const requests: string[] = [];
  const scopes: string[] = [];
  const puts: HomeFixture["puts"] = [];
  const registry = REGISTRY.filter((key) => wakeword || key.key !== "voice.wakeword.enabled");
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/api/settings") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { scope: string; key: string; value: unknown };
      puts.push(body);
      const def = registry.find((k) => k.key === body.key)!;
      return Promise.resolve(Response.json({ key: def.key, value: body.value, source: "user", label: def.label, help: def.help, level: def.level, secret: def.secret ?? false }));
    }
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.endsWith("/api/voice/cloned")) return Promise.resolve(Response.json({ voices: [] }));
    if (url.includes("/api/settings?scope=")) {
      const scope = decodeURIComponent(url.split("scope=")[1] ?? "");
      scopes.push(scope);
      const kind = scope.split(":")[0];
      return Promise.resolve(Response.json(registry.filter((k) => k.scope === kind).map((k) => ({ key: k.key, value: k.default ?? null, source: "default", label: k.label, help: k.help, level: k.level, secret: k.secret ?? false }))));
    }
    if (url.includes("/api/voice/wakewords")) return Promise.resolve(Response.json({ detectors: [], installed: wakeword }));
    if (url.endsWith("/api/commands")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/devices/robots")) return Promise.resolve(Response.json(robots ? [{ id: "d1", kind: "robot", name: "Robot" }] : []));
    if (url.includes("/api/devices")) return Promise.resolve(Response.json(robots ? [{ id: "d1", kind: "robot", name: "Robot" }] : []));
    if (url.endsWith("/api/people") || url.includes("/api/people?")) return Promise.resolve(Response.json(hasChild ? [{ id: "person-kid", role: "child", display_name: "Kid" }] : []));
    if (url.includes("/api/plugins/skills")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/biometric-prints")) return Promise.resolve(Response.json([]));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { requests, scopes, puts, restore: () => { globalThis.fetch = original; } };
}
