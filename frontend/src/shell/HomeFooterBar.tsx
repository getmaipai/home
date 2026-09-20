import { FooterBar, type FooterBarStatus } from "@maipai/ui/src/blocks/dashboard/components/FooterBar";
import { useHubStatus, engineCount, updateAvailable } from "@/shell/useHubStatus";
import { version } from "../../../package.json";
import type { HealthStatus, Issue, Roster } from "@/lib/api";

// The aggregate status/label (spec "Fixed footer"): a real repair count
// wins when one is actually known (owner/admin, and the read has
// resolved); otherwise falls back to `health.ok` - available to every
// signed-in person, not just an admin - rather than defaulting to "ok"
// for "not yet known", which a review caught briefly claiming "All
// systems operational" for an admin whose repairs read simply hadn't
// resolved yet, the same false-positive the per-role gating fix was
// meant to remove.
function footerStatus(canManage: boolean, repairs: Issue[] | undefined, health: HealthStatus | undefined): { status: FooterBarStatus; label: string } {
  const openRepairs = canManage && repairs ? repairs.length : null;
  if (openRepairs !== null && openRepairs > 0) {
    return { status: openRepairs >= 3 ? "error" : "warning", label: `${openRepairs} repair${openRepairs === 1 ? "" : "s"} need attention` };
  }
  if (health) return { status: health.ok ? "ok" : "warning", label: health.ok ? "All systems operational" : "Needs attention" };
  return { status: "ok", label: "Checking..." };
}

// The fixed footer (spec "Fixed footer"/"Footer summary reference"):
// version at left, real operational counts at center, in the reference's
// own order (updates, installed/running, repairs) - each segment omitted
// rather than shown as a fabricated zero until its own read has
// answered - a status dot and health at right. Repairs is owner/admin
// only (useHubStatus.ts): its count segment stays honestly omitted for
// anyone else (the `repairs ?` guard below).
export function HomeFooterBar({ person }: { person: Roster }) {
  const { health, repairs, updates, canManage } = useHubStatus(person.role);
  const engines = engineCount(health);
  const openRepairs = repairs?.length ?? 0;
  const hasUpdate = updateAvailable(updates);
  const { status, label: statusLabel } = footerStatus(canManage, repairs, health);
  return (
    <FooterBar
      version={`MaiPai Home v${version}`}
      counts={[
        ...(updates ? [{ label: hasUpdate ? "1 update available" : "Up to date", href: "/settings" }] : []),
        ...(health ? [{ label: `${engines.running} engine${engines.running === 1 ? "" : "s"} running`, href: "/settings/health" }] : []),
        ...(repairs ? [{ label: `${openRepairs} repair${openRepairs === 1 ? "" : "s"} open`, href: "/settings/repairs" }] : []),
      ]}
      status={status}
      statusLabel={statusLabel}
    />
  );
}
