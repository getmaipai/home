// The one gear of a job on AI and models: a summary of its levels. Each level shows the model it uses and whether that is the recommended
// pick or a custom one; selecting a level opens just that level to edit (Standard opens the model chooser, the others the single-level editor).
// Kit Elements as shipped (rule 9); the page renders the kit Dialog around this content. Jobs without levels never open this.
import { i18n } from "@lingui/core";
import { Badge } from "@maipai/ui/src/ui/badge";
import { DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@maipai/ui/src/ui/dialog";
import { Button } from "@maipai/ui/src/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { getIcon } from "@maipai/ui/src/icons";
import type { GlanceRow } from "@/apps/settings/aiGlanceRows";
import type { TierPicks } from "@/lib/aiChoicesApi";
import { MAX_RECOMMENDED_LABEL } from "../../../../shared/tierSlotOptions";
import { TIERED_JOBS, configurableTiers, isOn, type SlotDraft, type SlotDrafts, type SlotTier } from "@/apps/settings/aiTierSlots";

const levelTitle = (tier: SlotTier): string => ({ standard: i18n._({ id: "Standard", message: "Standard" }), boost: i18n._({ id: "Boost", message: "Boost" }), max: i18n._({ id: "Max", message: "Max" }), reduced: i18n._({ id: "Simplified chat for big jobs", message: "Simplified chat for big jobs" }) } as Record<SlotTier, string>)[tier];
const levelLine = (tier: SlotTier): string => ({
  standard: i18n._({ id: "Everyday use. Home keeps working normally.", message: "Everyday use. Home keeps working normally." }),
  boost: i18n._({ id: "A stronger pick when someone asks for more. Other big jobs wait their turn.", message: "A stronger pick when someone asks for more. Other big jobs wait their turn." }),
  max: i18n._({ id: "The best this computer can do. It takes the computer while it runs.", message: "The best this computer can do. It takes the computer while it runs." }),
  reduced: i18n._({ id: "When a Max job needs more room than is free, chat switches to a simpler model while it runs.", message: "When a Max job needs more room than is free, chat switches to a simpler model while it runs." }),
} as Record<SlotTier, string>)[tier];

export interface LevelSummary { tier: SlotTier; model: string; kind: "recommended" | "custom" | "off"; note: string | null }

/** What each level of a job reads as: the model's name, whether it is the recommended pick, and a note when it has no model of its own. Pure, so the test reads it. */
export function summarize(row: GlanceRow, drafts: SlotDrafts, picks: TierPicks | null): LevelSummary[] {
  const labelOf = (tier: SlotTier, draft: SlotDraft): string => {
    const level = picks?.levels.find((candidate) => candidate.tier === tier);
    const id = draft.model === "recommended" ? level?.recommended : draft.model;
    return level?.candidates.find((candidate) => candidate.id === id)?.label ?? row.options.find((option) => option.id === id)?.label ?? (draft.model === "recommended" ? row.recommended?.label : undefined) ?? i18n._({ id: "your pick", message: "your pick" });
  };
  return configurableTiers(row.job).map((tier): LevelSummary => {
    if (tier === "standard") {
      const shown = row.shown;
      return { tier, model: shown?.label ?? i18n._({ id: "No model chosen", message: "No model chosen" }), kind: !row.shownEnabled ? "off" : row.badge === "custom" ? "custom" : "recommended", note: null };
    }
    const draft = drafts[tier];
    if (!isOn(draft)) return { tier, model: i18n._({ id: "Off", message: "Off" }), kind: "off", note: null };
    if (tier === "max" && draft.model === "recommended" && !(picks?.levels.find((candidate) => candidate.tier === "max")?.recommended)) {
      // MUSIC-MAX-01: music's Max is the engine's own maker, named here; every other kind has no Max model until an admin picks one.
      const own = MAX_RECOMMENDED_LABEL[TIERED_JOBS[row.job]?.category ?? ""];
      return { tier, model: own ?? i18n._({ id: "No model of its own on this computer yet", message: "No model of its own on this computer yet" }), kind: "recommended", note: null };
    }
    return { tier, model: labelOf(tier, draft), kind: draft.model === "recommended" ? "recommended" : "custom", note: null };
  });
}

export interface AiJobSummaryProps {
  row: GlanceRow;
  drafts: SlotDrafts;
  picks: TierPicks | null;
  copy: Record<string, string>;
  onEdit: (tier: SlotTier) => void;
  onClose: () => void;
}

export function AiJobSummary({ row, drafts, picks, copy, onEdit, onClose }: AiJobSummaryProps) {
  const Next = getIcon("chevron-right");
  const levels = summarize(row, drafts, picks);
  return (
    <>
      <DialogHeader>
        <p className="text-base font-medium uppercase tracking-wide text-muted-foreground">{row.title}</p>
        <DialogTitle>{copy.summary_title ?? i18n._({ id: "Levels and models", message: "Levels and models" })}</DialogTitle>
        <DialogDescription>{copy.summary_note ?? i18n._({ id: "Pick a level to change its model or who can use it.", message: "Pick a level to change its model or who can use it." })}</DialogDescription>
      </DialogHeader>
      <ItemGroup variant="card" role="group" aria-label={i18n._({ id: "{title} levels", message: "{title} levels", values: { title: row.title } })}>
        {levels.map((level) => (
          <Item key={level.tier} data-testid={`ai-summary-${level.tier}`}>
            <ItemContent>
              <ItemTitle>
                {levelTitle(level.tier)}
                <Badge variant={level.kind === "off" ? "secondary" : "default"} tone={level.kind === "recommended" ? "success" : undefined}>
                  {level.kind === "off" ? (copy.disabled ?? i18n._({ id: "Off", message: "Off" })) : level.kind === "custom" ? (copy.custom ?? i18n._({ id: "Custom", message: "Custom" })) : (copy.recommended ?? i18n._({ id: "Recommended", message: "Recommended" }))}
                </Badge>
              </ItemTitle>
              <ItemDescription clamp={false}>{level.model}</ItemDescription>
              <ItemDescription clamp={false}>{levelLine(level.tier)}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button type="button" variant="ghost" size="sm" aria-label={i18n._({ id: "Edit {level}: {title}", message: "Edit {level}: {title}", values: { level: levelTitle(level.tier), title: row.title } })} onClick={() => onEdit(level.tier)}>{i18n._({ id: "Edit", message: "Edit" })}<Next /></Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{copy.close ?? i18n._({ id: "Done", message: "Done" })}</Button></DialogFooter>
    </>
  );
}
