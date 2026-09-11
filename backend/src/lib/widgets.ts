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
import { listPackageIds, loadManifestOnly, meetsMinRole, runPlugin, withHouseholdPlaceDefault } from "@/lib/plugins";
import type { PersonRow } from "@/types";

export interface WidgetDescriptor {
  package: string;
  id: string;
  title: string;
  size: "card" | "row";
  refresh_s: number;
}

export interface WidgetItem {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: string;
  href?: string;
  image?: string;
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
    for (const widget of manifest.contributes?.widgets ?? []) {
      out.push({ package: id, id: widget.id, title: widget.title, size: widget.size, refresh_s: widget.refresh_s });
    }
  }
  return out;
}

/** Runs the declared widget's own package recipe with its own declared
 * `inputs`, overridden by `household.home_place` when the widget declares
 * a `place` and the household has set one (`withHouseholdPlaceDefault()`,
 * lib/plugins.ts - the same override `warmPackage()` applies), and wraps
 * the resulting reply into one widget item. Beyond `place`, `inputs` are
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

  const result = await runPlugin(packageId, actor, withHouseholdPlaceDefault(packageId, (widget.inputs ?? {}) as Record<string, unknown>));
  if (!result.ok) {
    // Fix B (docs/dev.md's "Chat reliability: the 2026-09-07 incident",
    // B2): a Tier 1 handler's genuine upstream failure is now a typed 502
    // carrying the manifest's own fallback_reply, not a thrown-away error
    // - shown as the widget's one item (the same fallback_reply chat
    // itself speaks for this exact failure) rather than dropping the
    // widget from the dashboard entirely.
    if (result.status === 502) {
      const text = result.fallback_reply.reply?.text ?? "Couldn't load this right now.";
      return { ok: true, status: 200, value: { as_of: new Date().toISOString(), items: [{ title: text }], degraded: true } };
    }
    return { ok: false, status: result.status, error: result.error };
  }
  const text = result.value.reply?.text ?? "";
  return { ok: true, status: 200, value: { as_of: new Date().toISOString(), items: [{ title: text }] } };
}
