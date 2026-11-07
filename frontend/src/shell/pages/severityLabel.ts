import { i18n } from "@lingui/core";

/** The person-facing word for an issue or health severity. An unknown value shows as written, capitalised. */
export function severityLabel(severity: string): string {
  if (severity === "critical") return i18n._({ id: "Critical", message: "Critical" });
  if (severity === "warning" || severity === "warn") return i18n._({ id: "Warning", message: "Warning" });
  if (severity === "info") return i18n._({ id: "Info", message: "Info" });
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}
