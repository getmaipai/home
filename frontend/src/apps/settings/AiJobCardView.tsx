// AIMODELS-PAGE-01: the two settings views the spec names for the AI and models Overview: `ai.job_choices` (one job's card)
// and `ai.always_on`. The settings shell hands each its spec card; the words come from the spec through /api/ai/choices (rule S5).
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { ApiError } from "@/lib/api";
import { aiChoicesApi } from "@/lib/aiChoicesApi";
import { AiJobChoices } from "@/apps/settings/AiJobChoices";
import { useAiChoices } from "@/apps/settings/useAiChoices";
import { sizeGb } from "../../../../shared/diskPlanMath";
import type { AiChoice, AiJobId } from "../../../../shared/aiChoices";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

const JOB_OF_GROUP: Record<string, AiJobId> = {
  "household.ai_chat": "chat", "household.ai_pictures": "pictures", "household.ai_videos": "videos",
  "household.ai_music": "music", "household.ai_voice": "voice", "household.ai_coding": "coding",
};

export function AiJobCardView({ card }: SettingsViewProps) {
  const { query, refresh } = useAiChoices();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const job = card?.group ? JOB_OF_GROUP[card.group] : undefined;
  const data = query.data;
  if (!data || data.stack !== "ok") return null;
  const found = data.cards.find((candidate) => candidate.id === job);
  if (!found) return null;

  async function act(choice: AiChoice) {
    setError(null); setBusyId(choice.id);
    try { await aiChoicesApi.choose(choice.job, choice.id); refresh(); }
    catch (e) { setError(e instanceof ApiError ? e.message : `Could not start ${choice.name}. Check that the engine is running, then try again.`); }
    finally { setBusyId(null); }
  }
  return (
    <>
      {error ? <Alert variant="destructive"><AlertTitle>That did not work</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      <AiJobChoices card={found} onAct={act} busyId={busyId} defaultOpen={false} />
    </>
  );
}

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
