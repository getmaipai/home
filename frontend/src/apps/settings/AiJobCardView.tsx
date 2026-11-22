// AIMODELS-PAGE-01: the settings view the spec names for the AI and models Overview's "Always on" card (`ai.always_on`). The settings shell hands each its
// spec card; the words come from the spec. STACK-MODELS-HOME-01: the size is the installed parts the Stack marks required (Home's component list), not a
// card total Home worked out itself.
import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { requestJson } from "@/lib/api";
import { sizeGb } from "../../../../shared/diskPlanMath";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

interface ComponentsView { stack: "ok" | "unreachable"; components: Array<{ requirement: string; state: string; size_bytes: number | null }> }

export function AiAlwaysOnView({ card }: SettingsViewProps) {
  const query = useQuery({ queryKey: ["components"], queryFn: () => requestJson<ComponentsView>("/api/components") });
  const data = query.data;
  if (!data || data.stack !== "ok") return null;
  const bytes = data.components.filter((part) => part.requirement === "required" && part.state === "installed").reduce((sum, part) => sum + (part.size_bytes ?? 0), 0);
  return (
    <section aria-label={card?.label ?? i18n._({ id: "Always on", message: "Always on" })} data-testid="ai-always-on">
      <ItemGroup variant="card">
        <Item>
          <ItemContent>
            <ItemTitle>{card?.label ?? i18n._({ id: "Always on", message: "Always on" })}</ItemTitle>
            <ItemDescription clamp={false}>{card?.description} {bytes > 0 ? i18n._({ id: "It takes {size}.", message: "It takes {size}.", values: { size: sizeGb(bytes) } }) : ""}</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
    </section>
  );
}
