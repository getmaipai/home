// SCHED-02: the Home Assistant side of a device schedule. Home is the source of truth: it creates, replaces and deletes
// automations whose id starts `maipai_` through Home Assistant's automation config API, and never touches any other id.
// The automation body is built by code from the task. Its alias and description are one fixed generic text, so Home
// Assistant learns the command and nothing about who asked or why; entity ids appear only in the action data.
import type { LanFetchInit, LanFetchResult } from "@/lib/lanFetch";

export type AutomationFetch = (path: string, init?: LanFetchInit) => Promise<LanFetchResult>;
export type AutomationResult = { ok: true } | { ok: false; kind: "refused" | "unreachable" | "timeout" };
export type AutomationListResult = { ok: true; ids: string[] } | { ok: false; kind: "refused" | "unreachable" | "timeout" };

export const AUTOMATION_ID = /^maipai_[a-z0-9]{16,}$/;
export const AUTOMATION_TEXT = "Made by MaiPai Home; edit it in Home";

/** `maipai_` plus 16 random lowercase hex characters from crypto random; never derived from anything else. */
export function newAutomationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `maipai_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export type AutomationAction = "turn_on" | "turn_off" | "set_brightness" | "activate";
export type AutomationSpec = {
  /** Local wall clock in Home Assistant's own time zone. */
  time: string;
  /** Set for a one-shot: the single date the automation may run on (YYYY-MM-DD). */
  date?: string;
  /** ISO weekdays (Monday is 1). Empty means every day. Ignored for a one-shot. */
  days: readonly number[];
  action: AutomationAction;
  value?: number;
  /** Native entity ids such as `light.porch`, all of one instance. */
  entityIds: readonly string[];
};

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;

type ServiceCall = { action: string; data: Record<string, unknown> };

function serviceCalls(spec: AutomationSpec): ServiceCall[] | null {
  if (spec.entityIds.length === 0 || spec.entityIds.some((id) => !ENTITY.test(id))) return null;
  const domainOf = (id: string): string => id.slice(0, id.indexOf("."));
  if (spec.action === "activate") {
    return spec.entityIds.every((id) => domainOf(id) === "scene") ? [{ action: "scene.turn_on", data: { entity_id: [...spec.entityIds] } }] : null;
  }
  if (spec.action === "set_brightness") {
    if (spec.value === undefined || !spec.entityIds.every((id) => domainOf(id) === "light")) return null;
    return [{ action: "light.turn_on", data: { entity_id: [...spec.entityIds], brightness_pct: spec.value } }];
  }
  const verb = spec.action === "turn_on" ? "turn_on" : "turn_off";
  const lights = spec.entityIds.filter((id) => domainOf(id) === "light");
  const others = spec.entityIds.filter((id) => domainOf(id) === "switch" || domainOf(id) === "fan");
  if (lights.length + others.length !== spec.entityIds.length) return null;
  return [
    ...(lights.length ? [{ action: `light.${verb}`, data: { entity_id: lights } }] : []),
    ...(others.length ? [{ action: `homeassistant.${verb}`, data: { entity_id: others } }] : []),
  ];
}

/** The automation config Home Assistant stores. Null when the spec names something an automation may not do. */
export function buildAutomationBody(spec: AutomationSpec): Record<string, unknown> | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(spec.time)) return null;
  const actions = serviceCalls(spec);
  if (!actions) return null;
  const conditions: Record<string, unknown>[] = [];
  if (spec.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.date)) return null;
    conditions.push({ condition: "template", value_template: `{{ now().strftime('%Y-%m-%d') == '${spec.date}' }}` });
  } else if (spec.days.length > 0) {
    if (spec.days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) return null;
    conditions.push({ condition: "time", weekday: spec.days.map((day) => WEEKDAYS[day - 1]) });
  }
  return {
    alias: AUTOMATION_TEXT,
    description: AUTOMATION_TEXT,
    mode: "single",
    triggers: [{ trigger: "time", at: `${spec.time}:00` }],
    conditions,
    actions,
  };
}

/** Only these request shapes ever leave this module; anything else is refused before it reaches the network. */
function allowed(method: string, path: string): boolean {
  const config = /^\/api\/config\/automation\/config\/(maipai_[a-z0-9]{16,})$/.exec(path);
  if (config) return method === "POST" || method === "DELETE" || method === "GET";
  if (path === "/api/states") return method === "GET";
  if (path === "/api/services/automation/reload") return method === "POST";
  return false;
}

function guarded(lanFetch: AutomationFetch): AutomationFetch {
  return (path, init) => allowed(init?.method ?? "GET", path) ? lanFetch(path, init) : Promise.resolve({ ok: false, kind: "refused" });
}

const json = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const good = (response: LanFetchResult): boolean => response.ok && response.status >= 200 && response.status < 300 && !response.truncated;
const failure = (response: LanFetchResult): AutomationResult => response.ok ? { ok: false, kind: "refused" } : { ok: false, kind: response.kind };

/** Home Assistant also reloads on a config save; the explicit reload is best effort and its failure does not undo the write. */
async function reload(lanFetch: AutomationFetch, token: string): Promise<void> {
  await lanFetch("/api/services/automation/reload", { method: "POST", headers: json(token), body: "{}" });
}

async function write(input: { lanFetch: AutomationFetch; token: string; id: string; body: Record<string, unknown> }): Promise<AutomationResult> {
  if (!AUTOMATION_ID.test(input.id)) return { ok: false, kind: "refused" };
  const lanFetch = guarded(input.lanFetch);
  const response = await lanFetch(`/api/config/automation/config/${input.id}`, { method: "POST", headers: json(input.token), body: JSON.stringify(input.body) });
  if (!good(response)) return failure(response);
  await reload(lanFetch, input.token);
  return { ok: true };
}

export const createAutomation = write;
/** The config API replaces the stored automation with the same id. */
export const updateAutomation = write;

/** An id that is already gone counts as deleted. */
export async function deleteAutomation(input: { lanFetch: AutomationFetch; token: string; id: string }): Promise<AutomationResult> {
  if (!AUTOMATION_ID.test(input.id)) return { ok: false, kind: "refused" };
  const lanFetch = guarded(input.lanFetch);
  const response = await lanFetch(`/api/config/automation/config/${input.id}`, { method: "DELETE", headers: json(input.token) });
  if (response.ok && response.status === 404) return { ok: true };
  if (!good(response)) return failure(response);
  await reload(lanFetch, input.token);
  return { ok: true };
}

/** The `maipai_` automation ids Home Assistant holds. A truncated or unreadable list is a failure, never a short list, so the caller cannot delete on a guess. */
export async function listMaipaiAutomationIds(input: { lanFetch: AutomationFetch; token: string }): Promise<AutomationListResult> {
  const response = await guarded(input.lanFetch)("/api/states", { headers: json(input.token) });
  if (!good(response)) return failure(response) as AutomationListResult;
  try {
    const rows: unknown = JSON.parse((response as { text: string }).text);
    if (!Array.isArray(rows)) return { ok: false, kind: "refused" };
    const ids = rows.flatMap((row): string[] => {
      if (!row || typeof row !== "object") return [];
      const { entity_id: entityId, attributes } = row as { entity_id?: unknown; attributes?: { id?: unknown } };
      const id = attributes?.id;
      return typeof entityId === "string" && entityId.startsWith("automation.") && typeof id === "string" && AUTOMATION_ID.test(id) ? [id] : [];
    });
    return { ok: true, ids };
  } catch { return { ok: false, kind: "refused" }; }
}
