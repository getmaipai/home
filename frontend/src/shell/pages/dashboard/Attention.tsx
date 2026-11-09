import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { api, type UpdateProjection } from "@/lib/api";
import { hasUpdate, rowsFrom } from "@/apps/settings/updatesData";

/** True when anything in the update projection (the app, the engine, a model, a reference set or a robot) has a newer version. */
export function updatesWaiting(projection: UpdateProjection | undefined): boolean {
  if (!projection || typeof projection !== "object") return false;
  try { return rowsFrom(projection).some(hasUpdate); } catch { return false; }
}

/** What needs an admin's attention, as the kit's status cards (RULES S6: the Repairs and Updates data, nothing new): drawn only while
 * something is waiting, each with one quiet button to the page that handles it. Same query keys as those pages, so no extra fetch there. */
export function Attention() {
  const navigate = useNavigate();
  const updates = useQuery({ queryKey: ["updates"], queryFn: () => api.updates(), retry: false });
  const repairs = useQuery({ queryKey: ["repairs"], queryFn: () => api.repairs(), retry: false });
  const repairCount = Array.isArray(repairs.data) ? repairs.data.length : 0;
  const waiting = updatesWaiting(updates.data);
  if (!waiting && repairCount === 0) return null;
  return (
    <nav aria-label={i18n._({ id: "Looking after your hub", message: "Looking after your hub" })} className="flex flex-col gap-3 md:grid md:grid-cols-2">
      {repairCount > 0 ? <StatusCard kind="attention" textStyle="status" title={i18n._({ id: "Something needs fixing", message: "Something needs fixing" })} line={i18n._({ id: "Repairs lists what to do.", message: "Repairs lists what to do." })} action={{ label: i18n._({ id: "Repairs", message: "Repairs" }), tone: "quiet", onSelect: () => navigate("/repairs") }} /> : null}
      {waiting ? <StatusCard kind="info" textStyle="status" title={i18n._({ id: "An update is ready", message: "An update is ready" })} line={i18n._({ id: "Updates lets you review and apply it.", message: "Updates lets you review and apply it." })} action={{ label: i18n._({ id: "Updates", message: "Updates" }), tone: "quiet", onSelect: () => navigate("/updates") }} /> : null}
    </nav>
  );
}
