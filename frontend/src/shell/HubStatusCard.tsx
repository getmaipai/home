import { useNavigate } from "react-router-dom";
import { HubCard, type HubCardStatus } from "@maipai/ui/src/blocks/dashboard/components/HubCard";
import { useSidebar } from "@maipai/ui/src/ui/sidebar";
import { useHubStatus, platformLabel } from "@/shell/useHubStatus";
import type { Roster } from "@/lib/api";

// The rail's bottom hub card (spec "The shell, exactly"): the hub's
// name, OS and version, a status dot with "All systems healthy" or the
// count of open repairs; tapping opens Repairs (Settings, until Repairs
// is its own destination - RepairsSection.tsx lives there today).
// Hardware and repairs are owner/admin-only reads (useHubStatus.ts) -
// anyone else sees the hub's generic identity and an honest "ask an
// admin" status rather than a fabricated "healthy".
export function HubStatusCard({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const { hardware, repairs, canManage } = useHubStatus(person.role);
  const { state } = useSidebar();
  // Three real states, not two: an admin whose repairs read hasn't
  // resolved yet must not flash the same "All systems healthy" a real
  // zero gets (a review caught the two-state version doing exactly
  // that for the brief window before the query settles).
  const status: HubCardStatus = !canManage || !repairs ? "ok" : repairs.length === 0 ? "ok" : repairs.length >= 3 ? "error" : "warning";
  const statusLabel = !canManage ? "Ask an admin about repairs" : !repairs ? "Checking..." : repairs.length === 0 ? "All systems healthy" : `${repairs.length} repair${repairs.length === 1 ? "" : "s"} open`;
  return (
    <HubCard
      collapsed={state === "collapsed"}
      name={hardware?.computerName ?? "This hub"}
      subtitle={canManage ? (hardware ? `${platformLabel(hardware.platform)} ${hardware.osVersion}` : "Checking...") : "Your household's hub"}
      status={status}
      statusLabel={statusLabel}
      onClick={() => navigate("/settings/repairs")}
    />
  );
}
