// Step 9's own widgets half (docs/plans/session-d-packages-and-store.md):
// the frozen D-to-E contract (docs/plans/wave-2.md, "Widgets:
// manifest gains contributes.widgets[]... GET /api/widgets lists the
// actor's available widgets; GET /api/widgets/:package/:id/data returns
// {as_of, items}... served from the package cache, never a live fetch
// in the request path unless the cache is empty").
//
// Deliberately no new data-shaping mechanism per package: a widget's
// `inputs` are resolved and run exactly the way `warmPackage()`
// (lib/plugins.ts) already resolves `warm.keys` - "run the recipe with
// realistic inputs the ordinary way." `host.fetch` is already
// cache-aware (lib/packageCache.ts), so a package whose own warm job
// already kept its cache fresh answers instantly here too; one that
// hasn't warmed yet does one real fetch, matching "never a live fetch...
// unless the cache is empty" literally rather than needing a second,
// parallel cache-peeking code path. The reply text itself - already
// each package's own tested, human-readable summary - becomes the
// widget's one item; no bespoke "produce structured widget data"
// function per package, the same "one definition, one implementation"
// reasoning the org's own standards state outright.
import { listPackageIds, loadManifestOnly, meetsMinRole, runPlugin } from "@/lib/plugins";
import { getActiveInstall } from "@/lib/packageResolve";
import { getPersonSettingValue, setValue } from "@/lib/settings";
import { getPackageStatus } from "@/lib/smoke";
import { householdHomePlaceName } from "@/lib/places";
import { refusePackageReplyIfUnsafe } from "@/lib/safety";
import { speakerAgeBand } from "@/lib/ageBand";
import { deviceTilesFor } from "@/lib/house/widgetTiles";
import { listComingUp } from "@/lib/comingUp";
import { whenText } from "@/lib/alarmChat";
import type { PersonRow } from "@/types";

export interface WidgetDescriptor {
  package: string;
  id: string;
  title: string;
  size: "card" | "row" | "tiles";
  refresh_s: number;
  min_role: string;
  priority: number;
  hero: boolean;
  data?: string;
  surfaces: Array<"home" | "tv" | "robot">;
  inputs?: Record<string, unknown>;
  installed_at: string;
}

export interface OrderedHomeCards {
  hero: WidgetDescriptor | null;
  cards: WidgetDescriptor[];
  more: WidgetDescriptor[];
}

export interface WidgetItem {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: string;
  href?: string;
  image?: string;
  /** When this item happens or ends (ISO time). The Today card shows it as a relative time in the person's language. */
  at?: string;
}

export interface WidgetData {
  as_of: string;
  items: WidgetItem[];
  /** Set only when this widget's own package genuinely failed upstream
   * (a Tier 1 handler's typed 502) and `items` is showing its
   * `fallback_reply` text instead of real data - a code review
   * (2026-09-07) found the response otherwise reads identically to a
   * real success, so a caller that wants to tell the two apart (a
   * "couldn't refresh" indicator, rather than rendering the fallback
   * line as if it were live content) has no way to. Absent, not `false`,
   * on a genuine success - the common case stays exactly as small as it
   * was. */
  degraded?: true;
  /** The Devices widget's tiles (name, plain state, kind, on); `items` carries the same devices as text rows for a client without a tiles view. */
  tiles?: Array<{ id: string; name: string; state: string; icon: string; on: boolean }>;
  /** One answer block (today only `weather_card`) the Today row may draw in place of `items` for an adult; `items`
   * stays the text fallback for every other viewer and client (additive, HOME-PAGE-01 card block). */
  card?: Record<string, unknown>;
}

/** The weather widget's `weather_card` block, for an adult viewer only: a child or teen keeps the text item. */
export function widgetCardBlock(actor: PersonRow, blocks: unknown): Record<string, unknown> | undefined {
  if (speakerAgeBand(actor, new Date()) !== "adult" || !Array.isArray(blocks)) return undefined;
  const card = blocks.find((b): b is Record<string, unknown> => typeof b === "object" && b !== null && (b as { kind?: unknown }).kind === "weather_card");
  return card;
}

export type OpResult<T> = { ok: true; status: 200; value: T } | { ok: false; status: 400 | 403 | 404; error: string };

/** Every widget the actor's own role clears, across every bundled or
 * installed package - the same min_role floor `runPlugin()` itself
 * enforces before a widget's own data route ever runs its recipe. */
export function listWidgets(actor: { role: string }): WidgetDescriptor[] {
  const out: WidgetDescriptor[] = [];
  for (const id of listPackageIds()) {
    const loaded = loadManifestOnly(id);
    if (!loaded.ok) continue;
    const manifest = loaded.value;
    if (!meetsMinRole(actor.role, manifest.min_role)) continue;
    const installedAt = getActiveInstall(id)?.installedAt ?? "";
    for (const widget of manifest.contributes?.widgets ?? []) {
      out.push({ package: id, id: widget.id, title: widget.title, size: widget.size, refresh_s: widget.refresh_s,
        min_role: widget.min_role ?? manifest.min_role, priority: widget.priority ?? 50, hero: widget.hero ?? false,
        ...(widget.data ? { data: widget.data } : {}), surfaces: widget.surfaces ?? ["home"],
        ...(widget.inputs ? { inputs: widget.inputs as Record<string, unknown> } : {}), installed_at: installedAt });
    }
  }
  return out;
}

export const widgetKey = (widget: { package: string; id: string }) => `${widget.package}/${widget.id}`;

/** A person setting that holds a JSON list of card ids; anything else reads as an empty list. */
function personIdList(person: PersonRow, key: "ui.home_hidden" | "ui.home_order"): string[] {
  const value = getPersonSettingValue(person, key);
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

const byPriority = (a: WidgetDescriptor, b: WidgetDescriptor) => b.priority - a.priority || a.installed_at.localeCompare(b.installed_at) || a.id.localeCompare(b.id);

/** Widgets the person's role, the package state and the surface allow, before their own hidden list. */
function allowedWidgets(widgets: WidgetDescriptor[], person: PersonRow, surface: "home" | "tv" | "robot"): WidgetDescriptor[] {
  return widgets.filter((widget) => {
    const loaded = loadManifestOnly(widget.package);
    if (!meetsMinRole(person.role, widget.min_role)) return false;
    if (loaded.ok && !meetsMinRole(person.role, loaded.value.min_role)) return false;
    if (getPackageStatus(widget.package).status !== "enabled") return false;
    if (!widget.surfaces.includes(surface)) return false;
    if (surface !== "home" && Object.keys(widget.inputs ?? {}).some((key) => /person|people|user|profile/i.test(key))) return false;
    if (surface === "home" && loaded.ok && loaded.value.incognito === "blocked") return false;
    return true;
  });
}

/** The person's own order first (unknown ids ignored), every other widget after it in package priority order. */
function applyPersonOrder(widgets: WidgetDescriptor[], order: string[]): WidgetDescriptor[] {
  const rest = [...widgets].sort(byPriority);
  const placed: WidgetDescriptor[] = [];
  for (const id of order) {
    const at = rest.findIndex((widget) => widgetKey(widget) === id);
    if (at >= 0) placed.push(...rest.splice(at, 1));
  }
  return [...placed, ...rest];
}

/** Orders the actor's visible Home widgets. Package installs without a store
 * timestamp use the empty timestamp, which keeps the sort stable for the
 * bundled default set. The hero is still chosen by priority (unless hidden);
 * the person's `ui.home_order` arranges everything else. */
export function orderHomeCards(widgets: WidgetDescriptor[], person: PersonRow, surface: "home" | "tv" | "robot"): OrderedHomeCards {
  const hidden = new Set(personIdList(person, "ui.home_hidden"));
  const eligible = allowedWidgets(widgets, person, surface).filter((widget) => !hidden.has(widgetKey(widget)));
  const hero = eligible.filter((widget) => widget.hero).sort(byPriority)[0] ?? null;
  const rest = applyPersonOrder(eligible.filter((widget) => widget !== hero), personIdList(person, "ui.home_order"));
  return { hero, cards: rest.slice(0, 4), more: rest.slice(4) };
}

export interface ArrangeCard extends WidgetDescriptor { key: string; hidden: boolean }

/** Every Home card this person may see, hidden ones included, in their current order, for the Arrange screen. */
export function arrangeHomeCards(widgets: WidgetDescriptor[], person: PersonRow): ArrangeCard[] {
  const hidden = new Set(personIdList(person, "ui.home_hidden"));
  const allowed = allowedWidgets(widgets, person, "home");
  // Same order Home uses: the hero (by priority, among visible heroes) leads, then the person's order.
  const hero = allowed.filter((widget) => widget.hero && !hidden.has(widgetKey(widget))).sort(byPriority)[0];
  const rest = applyPersonOrder(allowed.filter((widget) => widget !== hero), personIdList(person, "ui.home_order"));
  return [...(hero ? [hero] : []), ...rest].map((widget) => ({ ...widget, key: widgetKey(widget), hidden: hidden.has(widgetKey(widget)) }));
}

/** Saves the person's order and hidden list through the settings write path. Only cards this person may already see can be named. */
export function saveHomeArrangement(person: PersonRow, widgets: WidgetDescriptor[], order: string[], hidden: string[]): OpResult<ArrangeCard[]> {
  const allowed = new Set(allowedWidgets(widgets, person, "home").map(widgetKey));
  const unknown = [...order, ...hidden].find((id) => !allowed.has(id));
  if (unknown !== undefined) return { ok: false, status: 400, error: "That card is not available to you. Reopen Arrange and try again." };
  const scope = `person:${person.id}`;
  for (const [key, ids] of [["ui.home_order", order], ["ui.home_hidden", hidden]] as const) {
    const written = setValue(person, scope, key, JSON.stringify([...new Set(ids)]));
    if (!written.ok) return { ok: false, status: written.status === 403 ? 403 : 400, error: written.error };
  }
  return { ok: true, status: 200, value: arrangeHomeCards(widgets, person) };
}

/** Runs the declared widget's own package recipe with its own declared
 * `inputs`, using the household home from `householdHomePlaceName()` when the
 * weather widget declares a `place` (the same household-only choice the
 * warm runner applies), and wraps the resulting reply into one item. Beyond `place`, `inputs` are
 * still literal manifest placeholders until a real settings-resolution
 * pass exists for arbitrary widget inputs; a known, shared gap, not
 * something this step invented. Never a live network call OF ITS OWN: the
 * underlying `host.fetch` is what's cache-aware, and this is exactly the
 * same call a live chat turn or a warm tick already makes. */
export async function getWidgetData(actor: PersonRow, packageId: string, widgetId: string): Promise<OpResult<WidgetData>> {
  const loaded = loadManifestOnly(packageId);
  if (!loaded.ok) return { ok: false, status: 404, error: "no such package" };
  const manifest = loaded.value;
  const widget = manifest.contributes?.widgets?.find((w) => w.id === widgetId);
  if (!widget) return { ok: false, status: 404, error: "no such widget" };
  if (!meetsMinRole(actor.role, manifest.min_role)) return { ok: false, status: 403, error: `${packageId} needs role ${manifest.min_role} or higher` };

  if (packageId === "remind" && widgetId === "upcoming") return comingUpWidget(actor, "reminder");
  if (packageId === "timer" && widgetId === "running") return comingUpWidget(actor, "timer");
  if (packageId === "house" && widgetId === "devices") return devicesWidget(actor);

  const inputs = { ...((widget.inputs ?? {}) as Record<string, unknown>) };
  if (packageId === "weather") {
    const place = householdHomePlaceName();
    if (!place) return { ok: false, status: 404, error: "household home is not set" };
    inputs.place = place;
  }
  const result = await runPlugin(packageId, actor, inputs);
  if (!result.ok) {
    // Fix B (docs/dev.md's "Chat reliability: the 2026-09-07 incident",
    // B2): a Tier 1 handler's genuine upstream failure is now a typed 502
    // carrying the manifest's own fallback_reply, not a thrown-away error
    // - shown as the widget's one item (the same fallback_reply chat
    // itself speaks for this exact failure) rather than dropping the
    // widget from the dashboard entirely.
    if (result.status === 502) {
      // #86: the fallback line meets the same boundary as a successful answer.
      const fallback = refusePackageReplyIfUnsafe(actor, result.fallback_reply) ?? result.fallback_reply;
      const text = fallback.reply?.text ?? "Couldn't load this right now.";
      return { ok: true, status: 200, value: { as_of: new Date().toISOString(), items: [{ title: text }], degraded: true } };
    }
    return { ok: false, status: result.status, error: result.error };
  }
  // CHAT-02: the one output boundary, for text that reaches the
  // dashboard without a chat turn.
  const text = (refusePackageReplyIfUnsafe(actor, result.value) ?? result.value).reply?.text ?? "";
  const card = packageId === "weather" ? widgetCardBlock(actor, (result.value as { blocks?: unknown }).blocks) : undefined;
  return { ok: true, status: 200, value: { as_of: new Date().toISOString(), items: [{ title: text }], ...(card ? { card } : {}) } };
}

/** The most rows a Next up or Timers card shows. */
const COMING_UP_CARD_ROWS = 3;

/** Next up (reminders) and Timers (running timers) read the person's own scheduled rows through the one coming-up list
 * the Coming up route already uses: no second reader. Nothing coming means no items, which Home hides. The text meets
 * the same output boundary as a package reply. */
function comingUpWidget(actor: PersonRow, kind: "reminder" | "timer"): OpResult<WidgetData> {
  const now = Date.now();
  const rows = listComingUp(actor)
    .filter((row) => row.kind === kind && Date.parse(row.at) > now)
    .slice(0, COMING_UP_CARD_ROWS);
  const fallback = kind === "timer" ? "Timer" : "Reminder";
  const items: WidgetItem[] = rows.map((row) => ({
    title: row.text.trim() || fallback,
    ...(kind === "reminder" ? { value: whenText(new Date(row.at)) } : {}),
    at: row.at,
  }));
  const unsafe = items.length > 0 && refusePackageReplyIfUnsafe(actor, { reply: { text: items.map((item) => item.title).join("\n") }, actions: [] }) !== null;
  return { ok: true, status: 200, value: { as_of: new Date(now).toISOString(), items: unsafe ? [] : items } };
}

/** Devices: the house tool's own visible devices as tiles. Nothing visible means no items, which Home hides. */
function devicesWidget(actor: PersonRow): OpResult<WidgetData> {
  const tiles = deviceTilesFor(actor);
  const items: WidgetItem[] = tiles.map((tile) => ({ title: tile.name, value: tile.state, icon: tile.icon }));
  return { ok: true, status: 200, value: { as_of: new Date().toISOString(), items, ...(tiles.length ? { tiles } : {}) } };
}
