// HOME-STACK-05: "the Repairs list shows the Stack's health items as
// data with their one fix button" - reusing lib/issues.ts's own
// raiseIssue()/resolveIssue()/registerFixHandler() machinery rather
// than a second Repairs-shaped data source: GET /api/repairs already
// renders any Issue row with a fix button, so syncing the Stack's
// GET /stack/v1/health list into that same table, on every read, means
// the existing frontend needs no new code at all to show them.
//
// Keyed `health.<code>` (never a bare code) so this never collides with
// stackEngine.ts's own `offline.<role>` issues, which also use
// `source: "stack"` for a different concern (Home's own connectivity to
// the Stack, not a problem the Stack itself is reporting about its
// engines).
import { isStackConfigured, getStackClient } from "@/lib/stackEngine";
import { raiseIssue, resolveIssue, registerFixHandler, listIssues, type IssueSeverity } from "@/lib/issues";
import type { HealthItem } from "@/lib/stack/types";

const HEALTH_KEY_PREFIX = "health.";

// Issue's own severity enum has no "critical" tier (issue.schema.json:
// info/warning/error) - the Stack's HealthItem does, so a critical item
// maps to Home's most severe tier rather than being dropped or
// mis-typed.
function toIssueSeverity(severity: "critical" | "error" | "warning"): IssueSeverity {
  return severity === "critical" ? "error" : severity;
}

function fixAction(code: string): string {
  return `stack_health_fix:${code}`;
}

/** Registered fresh on every sync (idempotent - Map.set on the same key
 * is a no-op re-add, same as sidecars.ts's own per-instance handlers)
 * rather than once at startup: the Stack's health codes are dynamic,
 * unknown until it reports them, unlike sidecars.ts's fixed, known-at-
 * startup role list. */
function registerHealthFixHandler(code: string): void {
  registerFixHandler(fixAction(code), async () => {
    await getStackClient().healthFix(code);
  });
}

/** Called from GET /api/repairs before listing: a live read-through,
 * not a background job - the Stack's own health list is cheap to fetch
 * and this keeps Home's Repairs table honest without a second poller
 * to keep in sync with the route's own cadence. A fetch failure here is
 * silent on purpose: stackEngine.ts's own offline.<role> issue already
 * covers "the Stack didn't answer" for the household; this sync adding
 * a second, redundant issue for the same outage would just be noise. */
export async function syncStackHealthIssues(): Promise<void> {
  if (!isStackConfigured()) return;
  let items: HealthItem[];
  try {
    ({ health: items } = await getStackClient().health());
  } catch {
    return;
  }

  const seenCodes = new Set<string>();
  for (const item of items) {
    seenCodes.add(item.code);
    if (item.fix) registerHealthFixHandler(item.code);
    await raiseIssue({
      source: "stack",
      key: `${HEALTH_KEY_PREFIX}${item.code}`,
      severity: toIssueSeverity(item.severity),
      title: item.title,
      detail: item.text,
      fix: item.fix ? { label: item.fix.label, action: fixAction(item.code) } : null,
    });
  }

  for (const issue of listIssues()) {
    if (issue.source !== "stack" || !issue.key.startsWith(HEALTH_KEY_PREFIX)) continue;
    const code = issue.key.slice(HEALTH_KEY_PREFIX.length);
    if (!seenCodes.has(code)) resolveIssue("stack", issue.key);
  }
}
