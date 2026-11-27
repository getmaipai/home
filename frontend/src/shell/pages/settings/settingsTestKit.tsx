// APP-SET-02: shared fixtures for the settings area tests (a test helper, not
// shipped): the real spec registry, a recording fetch, and a signed-in person
// of any role.
import { mock } from "bun:test";
import { seedChoicesView } from "@maipai/ui/src/stack/fakeStackData";
import registryJson from "@maipai/spec/settings/keys.json";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { Roster } from "@/lib/api";
import { bandOf } from "@/lib/audience";

export const REGISTRY = registryJson as unknown as SettingsKey[];

export function makePerson(role: Roster["role"], overrides: Partial<Roster> = {}): Roster & { age_band: "child" | "teen" | "adult" } {
  const band = bandOf({ role });
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

const route0 = (url: string): string => url.split("?")[0]!;

export interface HomeFixture {
  /** Every request the page made, as `METHOD url`. */
  requests: string[];
  /** The `scope=` of every settings values request. */
  scopes: string[];
  /** Every settings write, as the page sent it. */
  puts: Array<{ scope: string; key: string; value: unknown }>;
  /** The exact serialized pinned-apps value returned by settings reads. */
  pinnedAppsValue: () => string;
  restore: () => void;
}

export function mockHome({ robots = false, robotsEnabled = robots, wakeword = false, hasChild = false, setupChecklist = [], pinnedApps, stackGeneral = { where: "this_computer", reachable: true, version: "0.4.2", problems: 0, reason: null }, apps, extraKeys = [], places = [], attention = { items: [], areas: {} } }: { apps?: unknown[]; extraKeys?: SettingsKey[]; places?: Array<Record<string, unknown>>; robots?: boolean; robotsEnabled?: boolean; wakeword?: boolean; hasChild?: boolean; setupChecklist?: Array<{ id: string; title: string; reason: string; done: boolean; open: { label: string; href: string } }>; pinnedApps?: string[]; stackGeneral?: Record<string, unknown>; attention?: { items: Array<{ id: string; kind: "problem" | "missing" | "not_set_up"; area: string; title: string; line: string; action: { label: string; href: string } }>; areas: Record<string, { state: "ok" | "missing" | "problem" | "off" | "not_set_up"; summary: string }> } } = {}): HomeFixture {
  const original = globalThis.fetch;
  const requests: string[] = [];
  const scopes: string[] = [];
  const puts: HomeFixture["puts"] = [];
  // LEFTNAV-APPS-01: no `pinnedApps` option means the person never chose pins (the setting reads as its default).
  let pinnedAppsExplicit = pinnedApps !== undefined;
  let pinnedAppsSerialized = JSON.stringify(pinnedApps ?? []);
  const registry = [...REGISTRY.filter((key) => wakeword || key.key !== "voice.wakeword.enabled"), ...extraKeys];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/api/settings") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { scope: string; key: string; value: unknown };
      puts.push(body);
      if (body.key === "ui.pinned_apps") { pinnedAppsSerialized = String(body.value); pinnedAppsExplicit = true; }
      const def = registry.find((k) => k.key === body.key)!;
      return Promise.resolve(Response.json({ key: def.key, value: body.value, source: "user", label: def.label, help: def.help, level: def.level, secret: def.secret ?? false }));
    }
    if (apps && route0(url) === "/api/apps") return Promise.resolve(Response.json(apps));
    if (route0(url) === "/api/entities") return Promise.resolve(Response.json(places));
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.endsWith("/api/settings/capabilities")) return Promise.resolve(Response.json({ robotsEnabled }));
    if (url.endsWith("/api/voice/cloned")) return Promise.resolve(Response.json({ voices: [] }));
    if (url.endsWith("/api/plugins/stats")) return Promise.resolve(Response.json({ total: 0, plugin: 0, model: 0, commandError: 0, fallthroughRate: null, byPlugin: [] }));
    // ENGINES-AI-01: Engines and AI now draws the engines console and the model list as its trail view, so the
    // fixture answers what those read (an unconfigured Stack and a small Mac) instead of the bare "{}" below.
    const route = url.split("?")[0]!;
    if (route.endsWith("/api/auth/sessions/away")) return Promise.resolve(Response.json([]));
    if (route === "/api/apps") return Promise.resolve(Response.json([]));
    if (route.endsWith("/api/house/admin/registry")) return Promise.resolve(Response.json({ rooms: [{ id: "k", name: "Kitchen", entities: [{ id: "light.k", name: "Light", kind: "light", sensitive: null }, { id: "lock.front", name: "Front lock", kind: "lock", sensitive: "lock" }] }], people: [{ id: "person-owner", name: "Owner", role: "owner" }, { id: "person-teen", name: "Teen", role: "teen" }] }));
    if (route.endsWith("/api/house/admin/effective")) return Promise.resolve(Response.json({ rooms: { k: { see: false, control: false } }, entities: { "light.k": { see: false, control: false, confirm: false, sensitive: false }, "lock.front": { see: false, control: false, confirm: false, sensitive: true } } }));
    if (route.endsWith("/api/grants")) return Promise.resolve(Response.json([]));
    if (route === "/api/house/test" && init?.method === "POST") return Promise.resolve(Response.json({ ok: true, rooms: 2, devices: 4 }));
    if (route.endsWith("/api/setup-checklist")) return Promise.resolve(Response.json(setupChecklist));
    if (route.endsWith("/api/settings/attention")) return Promise.resolve(Response.json(attention));
    // STACK-MODELS-HOME-01: the AI and models page reads the Stack's choices through Home's forwarder; the kit's own seed stands in for the Stack.
    if (route.endsWith("/api/ai/stack/choices")) return Promise.resolve(Response.json(seedChoicesView()));
    // STACK-MENU-SYNC-01: the Models tab also draws Licences and Drives, and the Stack tabs read the admin link and the General state.
    // The Maintain tab draws the coding admin page (it was the Coding tab of AI and models).
    if (route.endsWith("/api/coding/pieces")) return Promise.resolve(Response.json({ stack: "ok", message: null, coding_enabled: false, engine: "splash", missing: null, pieces: [] }));
    if (route.endsWith("/api/coding/mode")) return Promise.resolve(Response.json({ readiness: { ready: false, first_unmet: null, checked_at: "2026-11-27T00:00:00.000Z", items: [], provenance: "test" }, mode: "normal", state: "ready", reason: null }));
    if (route.endsWith("/api/ai/stack/licences")) return Promise.resolve(Response.json({ terms_version: "2026-11-25", accepted: true, accepted_at: "2026-11-25T00:00:00.000Z", by: null, licences: [] }));
    if (route.endsWith("/api/ai/stack/disks")) return Promise.resolve(Response.json({ disks: [] }));
    if (route.endsWith("/api/ai/stack/disks/features")) return Promise.resolve(Response.json({ features: [] }));
    if (route.endsWith("/api/ai/stack/disks/moves")) return Promise.resolve(Response.json({ moves: [] }));
    if (route.endsWith("/api/ai/stack/admin-link")) return Promise.resolve(Response.json({ local_url: "http://127.0.0.1:8770/admin/", remote_url: null, reason: null, remote_state: "off", can_turn_on: false }));
    if (route.endsWith("/api/ai/stack/status")) return Promise.resolve(Response.json({ busy: { running: 1, waiting: 2 }, memory: { total_bytes: 137438953472, free_bytes: 53410299904, budget_bytes: 128849018880, pressure: "normal" }, jobs: [] }));
    if (route.endsWith("/api/ai/stack/resources/summary")) return Promise.resolve(Response.json({ sampled_at: "2026-11-27T10:00:00Z", current: { total: 137438953472, used: 64424509440, avail: 72000000000, pressure: 0 } }));
    if (route.endsWith("/api/ai/stack/resources/engines")) return Promise.resolve(Response.json({ sampled_at: "2026-11-27T10:00:00Z", budget: { total_bytes: 137438953472, cap_bytes: 128849018880, loaded_bytes: 30415837400 }, engines: [{ role: "chat", label: "Chat", state: "running", model_id: "nova-8b", memory_bytes: 25181984984 }, { role: "tts", label: "Voice out", state: "idle", model_id: null, memory_bytes: 5233852416 }, { role: "image", label: "Pictures", state: "idle", model_id: null, memory_bytes: 0 }] }));
    if (route.endsWith("/api/ai/stack/components")) return Promise.resolve(Response.json({ components: [{ id: "nova-8b", label: "Nova 8B", kind: "model" }] }));
    if (route.endsWith("/api/ai/stack/choices")) return Promise.resolve(Response.json({ categories: [{ role: "chat" }, { role: "image" }, { role: "tts" }] }));
    if (route.endsWith("/api/ai/stack/general")) return Promise.resolve(Response.json(stackGeneral));
    if (route.endsWith("/api/ai/stack/migration")) return Promise.resolve(Response.json({ done: true, done_at: "2026-11-22T00:00:00.000Z", accepted: 0, refused: [], dismissed: true }));
    if (route.endsWith("/api/engine-link/credentials")) return Promise.resolve(Response.json({ paired: false }));
    if (route.endsWith("/api/search/web")) return Promise.resolve(Response.json({ address: "", works: null, stackOwned: false, sources: ["ddgs"], ddgsReady: true }));
    if (route.endsWith("/api/engines/health")) return Promise.resolve(Response.json({ configured: false, health: [] }));
    if (route.endsWith("/api/engines")) return Promise.resolve(Response.json({ configured: false, roles: [], engines: [], budget: null }));
    if (url.includes("/api/host/hardware")) return Promise.resolve(Response.json({ platform: "darwin", totalRamGb: 24, cpuCount: 14, isAppleSilicon: true, unifiedMemoryGb: 24, cudaDevices: [] }));
    if (url.includes("/api/host/models/selection")) return Promise.resolve(Response.json({ modelId: null }));
    if (url.includes("/api/host/models")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/host/engine/status")) return Promise.resolve(Response.json({ kind: "none", modelId: null, pid: null, startedAt: null }));
    if (url.includes("/api/settings?scope=")) {
      const scope = decodeURIComponent(url.split("scope=")[1] ?? "");
      scopes.push(scope);
      const kind = scope.split(":")[0];
      return Promise.resolve(Response.json(registry.filter((k) => k.scope === kind).map((k) => ({ key: k.key, value: k.key === "ui.pinned_apps" ? pinnedAppsSerialized : k.default ?? null, source: k.key === "ui.pinned_apps" && pinnedAppsExplicit ? "user" : "default", label: k.label, help: k.help, level: k.level, secret: k.secret ?? false }))));
    }
    if (url.includes("/api/reference/state")) return Promise.resolve(Response.json({ installed: [], jobs: [], matchesPresets: [] }));
    if (url.includes("/api/reference/catalog")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/voice/wakewords")) return Promise.resolve(Response.json({ detectors: [], installed: wakeword }));
    if (url.endsWith("/api/commands")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/auth/sessions")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/devices/robots")) return Promise.resolve(Response.json(robots ? [{ id: "d1", kind: "robot", name: "Robot", capabilities: [] }] : []));
    if (url.includes("/api/devices")) return Promise.resolve(Response.json(robots ? [{ id: "d1", kind: "robot", name: "Robot", capabilities: [] }] : []));
    if (url.endsWith("/api/people") || url.includes("/api/people?")) return Promise.resolve(Response.json(hasChild ? [{ id: "person-kid", role: "child", display_name: "Kid" }] : []));
    if (url.includes("/api/plugins/skills")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/biometric-prints")) return Promise.resolve(Response.json([]));
    if (url.startsWith("/api/voice-prints?")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/memory")) return Promise.resolve(Response.json([]));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { requests, scopes, puts, pinnedAppsValue: () => pinnedAppsSerialized, restore: () => { globalThis.fetch = original; } };
}
