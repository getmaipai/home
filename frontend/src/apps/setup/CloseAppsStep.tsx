// MEM-SPACE-12: the setup wizard's one Close apps question. It appears only when the Mac app helper answers and a starter app is open, which is how a Mac used as a regular computer looks; a dedicated hub never sees it.
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { api, type SetupCloseApps } from "@/lib/api";
import { STARTER_ALWAYS } from "@/apps/settings/performanceModel";
import { usePerformanceSettings } from "@/apps/settings/usePerformanceSettings";

/** The starter apps that are open now: what the answer would act on. Empty means this Mac does not look like a regular computer. */
export const openStarterApps = (view: Pick<SetupCloseApps, "installed" | "apps">) => (view.installed ? STARTER_ALWAYS.filter((starter) => view.apps.some((app) => app.bundleId === starter.bundleId)) : []);

/** Reads whether the question applies. Anything unreadable counts as "no", so setup never waits on it. */
export function useCloseAppsQuestion(enabled: boolean): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.setupCloseApps().then((view) => { if (active) setShown(openStarterApps(view).length > 0); }, () => { if (active) setShown(false); });
    return () => { active = false; };
  }, [enabled]);
  return enabled && shown;
}

const REFUSED = "Home could not close a test app, so Close apps stays Off. You can try again later under Settings, then AI and models, then Performance.";

export function CloseAppsStep({ onDone }: { onDone: () => void }) {
  const { write } = usePerformanceSettings();
  const [choice, setChoice] = useState<"not_now" | "automatic">("not_now");
  const [apps, setApps] = useState<{ bundleId: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { api.setupCloseApps().then((view) => setApps(openStarterApps(view)), () => setApps([])); }, []);

  async function turnOn() {
    setBusy(true); setMessage(null);
    try {
      const { result } = await api.setupCloseAppsTest();
      if (result !== "ok") { setChoice("not_now"); setMessage(REFUSED); return; }
      await write({ "resources.close_apps.always": JSON.stringify(apps.map((app) => app.bundleId)), "resources.close_apps.mode": "automatic" });
      onDone();
    } catch { setChoice("not_now"); setMessage(REFUSED); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="close-apps-step">
      <p className="text-base text-muted-foreground md:text-lg">Home can quit apps like Safari when a big job needs room, and open them again afterwards. An app with unsaved work stays open.</p>
      <RadioGroup value={choice} onValueChange={(next) => setChoice(next as "not_now" | "automatic")}>
        <ItemGroup variant="card">
          <Item size="setting"><ItemContent><ItemTitle>Not now</ItemTitle><ItemDescription clamp={false}>Home never closes an app. You can change this later in Settings.</ItemDescription></ItemContent><ItemActions><RadioGroupItem value="not_now" aria-label="Not now" /></ItemActions></Item>
          <Item size="setting"><ItemContent><ItemTitle>Automatic</ItemTitle><ItemDescription clamp={false}>Home closes only the apps listed below, and only when a big job needs room.</ItemDescription></ItemContent><ItemActions><RadioGroupItem value="automatic" aria-label="Automatic" /></ItemActions></Item>
        </ItemGroup>
      </RadioGroup>
      {choice === "automatic" ? (
        <div className="flex flex-col gap-3">
          <p className="text-base font-medium md:text-lg">Apps that would be closed: {apps.map((app) => app.name).join(", ")}.</p>
          <div><Button type="button" size="lg" disabled={busy} onClick={() => void turnOn()}>{busy ? "Testing" : "Turn on Automatic"}</Button></div>
        </div>
      ) : null}
      {message ? <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert> : null}
    </div>
  );
}
