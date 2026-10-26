// AIMODELS-PAGE-01: the settings view the spec names for the AI and models Overview's "Always on" card (`ai.always_on`). The settings shell hands each its spec card; the words come from the spec through /api/ai/choices (rule S5).
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { useAiChoices } from "@/apps/settings/useAiChoices";
import { sizeGb } from "../../../../shared/diskPlanMath";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

export function AiAlwaysOnView({ card }: SettingsViewProps) {
  const { query } = useAiChoices();
  const data = query.data;
  if (!data || data.stack !== "ok") return null;
  return (
    <section aria-label={card?.label ?? "Always on"} data-testid="ai-always-on">
      <ItemGroup variant="card">
        <Item>
          <ItemContent>
            <ItemTitle>{card?.label ?? "Always on"}</ItemTitle>
            <ItemDescription clamp={false}>{card?.description} {data.alwaysOn.bytes > 0 ? `It takes ${sizeGb(data.alwaysOn.bytes)}.` : ""}</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
    </section>
  );
}
