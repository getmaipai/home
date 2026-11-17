// SETTINGS-AUDIT-01: recent owner and admin changes to safety settings, by role only (rule 6a). Owners and admins only.
import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/ui/table";
import { titleCaseOption } from "@maipai/ui/src/settings/SettingField";
import { api, isOwnerOrAdminRole, type SettingsChange, type SettingsKey } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { settingLabel, settingOptionLabel } from "@/lib/settingCopy";
import { PlainSection } from "./PlainSection";

function valueWords(def: SettingsKey | undefined, value: unknown): string {
  if (value === null || value === undefined) return i18n._({ id: "Default", message: "Default" });
  if (typeof value === "boolean") return value ? i18n._({ id: "On", message: "On" }) : i18n._({ id: "Off", message: "Off" });
  if (typeof value === "string") {
    const labels = (def?.copy as { option_labels?: Record<string, string> } | undefined)?.option_labels;
    return def ? settingOptionLabel(def, value, labels?.[value] ?? titleCaseOption(value)) : titleCaseOption(value);
  }
  if (Array.isArray(value)) return value.length === 0 ? i18n._({ id: "Empty", message: "Empty" }) : value.map(String).join(", ");
  if (typeof value === "object") {
    const delta = value as { add?: unknown[]; remove?: unknown[] };
    const parts: string[] = [];
    if (delta.add?.length) parts.push(i18n._({ id: "Added {items}", message: "Added {items}", values: { items: delta.add.map(String).join(", ") } }));
    if (delta.remove?.length) parts.push(i18n._({ id: "Removed {items}", message: "Removed {items}", values: { items: delta.remove.map(String).join(", ") } }));
    if (parts.length) return parts.join("; ");
  }
  return String(value);
}

const directionWords = (direction: SettingsChange["direction"]): string =>
  direction === "widens" ? i18n._({ id: "Widened", message: "Widened" })
    : direction === "narrows" ? i18n._({ id: "Narrowed", message: "Narrowed" })
    : i18n._({ id: "Changed", message: "Changed" });

export function SafetyChangesSection({ viewerRole }: { viewerRole: string }) {
  const allowed = isOwnerOrAdminRole(viewerRole);
  const changes = useQuery({ queryKey: ["settings-changes"], queryFn: () => api.settingsChanges(), enabled: allowed });
  const registry = useQuery({ queryKey: ["settings-registry"], queryFn: () => api.settingsRegistry(), enabled: allowed });
  if (!allowed) return null;
  const rows = changes.data?.changes ?? [];
  const defs = new Map((registry.data ?? []).map((def) => [def.key, def]));
  return (
    <PlainSection heading={i18n._({ id: "Recent safety changes", message: "Recent safety changes" })} id="safety-changes">
      {changes.isSuccess && rows.length === 0 ? (
        <p className="text-muted-foreground">{i18n._({ id: "No safety setting changes yet.", message: "No safety setting changes yet." })}</p>
      ) : rows.length > 0 ? (
        <Table data-testid="safety-changes">
          <TableHeader>
            <TableRow>
              <TableHead>{i18n._({ id: "When", message: "When" })}</TableHead>
              <TableHead>{i18n._({ id: "Setting", message: "Setting" })}</TableHead>
              <TableHead>{i18n._({ id: "Who", message: "Who" })}</TableHead>
              <TableHead>{i18n._({ id: "Where", message: "Where" })}</TableHead>
              <TableHead>{i18n._({ id: "Change", message: "Change" })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const def = defs.get(row.key);
              return (
                <TableRow key={row.id}>
                  <TableCell>{formatDateTime(row.changed_at)}</TableCell>
                  <TableCell>{def ? settingLabel(def) : row.key}</TableCell>
                  <TableCell>{row.actor_role === "owner" ? i18n._({ id: "Owner", message: "Owner" }) : i18n._({ id: "Admin", message: "Admin" })}</TableCell>
                  <TableCell>{row.scope === "household" ? i18n._({ id: "Household", message: "Household" }) : i18n._({ id: "One person", message: "One person" })}</TableCell>
                  <TableCell>{directionWords(row.direction)}: {valueWords(def, row.value)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
    </PlainSection>
  );
}
