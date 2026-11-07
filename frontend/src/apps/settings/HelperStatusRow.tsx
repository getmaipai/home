// MEM-SPACE-08 / RULES S6: the Mac app helper's state as a plain status row, never a hidden control. Shown by the Close apps card and the setup wizard question while the helper is not installed.
import { i18n } from "@lingui/core";
import { useState } from "react";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import type { HelperInstall } from "@/lib/api";

const notMac = () => i18n._({ id: "The helper works only when Home runs on a Mac, so Close apps stays Off on this computer.", message: "The helper works only when Home runs on a Mac, so Close apps stays Off on this computer." });
const failedText = () => i18n._({ id: "Home could not install the helper. Press Install helper to try again.", message: "Home could not install the helper. Press Install helper to try again." });

/** `canInstall` false means this hub cannot offer the install (not a Mac, or an older install without the installer): the row then says why and shows no button. */
export function HelperStatusRow({ canInstall, install, onInstalled }: { canInstall: boolean; install: () => Promise<HelperInstall>; onInstalled: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function run() {
    setBusy(true); setProblem(null);
    try {
      const outcome = await install();
      if (outcome.result === "installed") onInstalled(); else setProblem(outcome.message);
    } catch { setProblem(failedText()); } finally { setBusy(false); }
  }
  return (
    <div data-testid="helper-status" className="flex flex-col gap-2">
      <Item size="setting" role="status">
        <ItemContent>
          <ItemTitle>{i18n._({ id: "Helper not installed", message: "Helper not installed" })}</ItemTitle>
          <ItemDescription clamp={false}>{canInstall ? i18n._({ id: "Install it so Home can see and close apps when a big job needs room. It runs only for you on this Mac, is built here, and sends nothing anywhere. Close apps stays Off until you turn it on.", message: "Install it so Home can see and close apps when a big job needs room. It runs only for you on this Mac, is built here, and sends nothing anywhere. Close apps stays Off until you turn it on." }) : notMac()}</ItemDescription>
        </ItemContent>
        {canInstall ? <ItemActions><Button type="button" variant="outline" disabled={busy} onClick={() => void run()}>{busy ? i18n._({ id: "Installing, this can take a minute or two", message: "Installing, this can take a minute or two" }) : i18n._({ id: "Install helper", message: "Install helper" })}</Button></ItemActions> : null}
      </Item>
      {problem ? <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert> : null}
    </div>
  );
}
