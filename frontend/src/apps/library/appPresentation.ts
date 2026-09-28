import type { InstalledPackage } from "@/lib/api";
import type { IconName } from "@maipai/ui/src/icons";

interface KindStyle { label: string; hue: string; icon: IconName }

const KIND_STYLES: Record<string, KindStyle> = {
  plugin: { label: "Plugin", hue: "--hue-blue", icon: "puzzle" },
  companion: { label: "Companion", hue: "--hue-violet", icon: "bot" },
  skill: { label: "Skill", hue: "--hue-orange", icon: "sparkles" },
};

export function kindStyle(kind: string): KindStyle {
  return KIND_STYLES[kind] ?? { label: kind.charAt(0).toUpperCase() + kind.slice(1), hue: "--hue-blue", icon: "package" };
}

export function packageState(row: InstalledPackage): "Ready" | "Attention" {
  return row.status === "enabled" && row.smoke.ok !== false ? "Ready" : "Attention";
}
