import { i18n } from "@lingui/core";
import type { InstalledPackage } from "@/lib/api";
import type { IconName } from "@maipai/ui/src/icons";

interface KindStyle { label: string; hue: string; icon: IconName }

const kindStyles = (): Record<string, KindStyle> => ({
  plugin: { label: i18n._({ id: "Plugin", message: "Plugin" }), hue: "--hue-blue", icon: "puzzle" },
  companion: { label: i18n._({ id: "Companion", message: "Companion" }), hue: "--hue-violet", icon: "bot" },
  skill: { label: i18n._({ id: "Skill", message: "Skill" }), hue: "--hue-orange", icon: "sparkles" },
});

export function kindStyle(kind: string): KindStyle {
  return kindStyles()[kind] ?? { label: kind.charAt(0).toUpperCase() + kind.slice(1), hue: "--hue-blue", icon: "package" };
}

export function packageState(row: InstalledPackage): string {
  return row.status === "enabled" && row.smoke.ok !== false ? i18n._({ id: "Ready", message: "Ready" }) : i18n._({ id: "Attention", message: "Attention" });
}
