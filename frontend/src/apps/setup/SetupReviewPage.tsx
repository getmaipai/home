import { i18n } from "@lingui/core";
import { useEffect, useState } from "react";
import { getIcon } from "@maipai/ui/src/icons";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { useNavigate } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { api, ApiError } from "@/lib/api";
import { renderSetupReviewScreen } from "./SetupWizard";
import { errorLine } from "@/lib/hubReachability";

const ErrorIcon = getIcon("alert-triangle");
const BackIcon = getIcon("arrow-left");
const NextIcon = getIcon("arrow-right");
const DoneIcon = getIcon("check");
const CancelIcon = getIcon("x");

const REVIEW_SCREENS = ["engine_location", "storage", "checks", "plan"] as const;
type ReviewScreen = (typeof REVIEW_SCREENS)[number];

export function SetupReviewPage() {
  const navigate = useNavigate();
  const [screenIndex, setScreenIndex] = useState(0);
  const [engine, setEngine] = useState<"this_computer" | "another_computer">("this_computer");
  const [originalEngine, setOriginalEngine] = useState("this_computer");
  const [rows, setRows] = useState<Array<{ id: string; title: string; state: "green" | "amber" | "red" | "idle"; text: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkError, setCheckError] = useState(false);

  const screen: ReviewScreen = REVIEW_SCREENS[screenIndex]!;
  const refreshChecks = async () => {
    setCheckError(false);
    try { setRows(await api.setupReviewValues().then((values) => values.checks)); }
    catch { setCheckError(true); }
  };

  useEffect(() => {
    void api.setupReviewValues().then((values) => {
      const current = values.engine === "another_computer" ? "another_computer" : "this_computer";
      setEngine(current); setOriginalEngine(current); setRows(values.checks);
    }, (reason) => {
      if (reason instanceof ApiError && reason.status === 403) navigate("/", { replace: true });
      else setError(i18n._({ id: "Home couldn't load these setup choices. Refresh this page and try again.", message: "Home couldn't load these setup choices. Refresh this page and try again." }));
    });
  }, [navigate]);

  async function finish() {
    setBusy(true); setError(null);
    try {
      if (engine !== originalEngine) await api.setSetting("household", "engines.stack.where", engine);
      navigate("/repairs", { replace: true });
    } catch (reason) {
      setError(errorLine(reason, i18n._({ id: "Home couldn't save this choice. Check the engine link in Home settings, then try again.", message: "Home couldn't save this choice. Check the engine link in Home settings, then try again." })));
    } finally { setBusy(false); }
  }

  return <div>
    <section className="flex flex-col gap-4">
      <h1 className="text-section font-semibold">{i18n._({ id: "Setup review", message: "Setup review" })}</h1>
      <div className="flex flex-col gap-4">
        <p>{i18n._({ id: "Review your computers, files, checks, and plan.", message: "Review your computers, files, checks, and plan." })}</p>
        {renderSetupReviewScreen({ screen, engine, onEngineChange: setEngine, readOnly: screen === "storage", checkRows: rows, checkError, onRetryChecks: () => void refreshChecks() })}
        {error ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{error}</AlertDescription></Alert> : null}
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" aria-label={i18n._({ id: "Back", message: "Back" })} disabled={screenIndex === 0 || busy} onClick={() => setScreenIndex((index) => index - 1)}><BackIcon aria-hidden="true" /></Button>
          {screenIndex < REVIEW_SCREENS.length - 1 ? <Button type="button" variant="ghost" size="icon" aria-label={i18n._({ id: "Continue", message: "Continue" })} disabled={busy} onClick={() => setScreenIndex((index) => index + 1)}><NextIcon aria-hidden="true" /></Button> : <Button type="button" variant="ghost" size="icon" aria-label={busy ? i18n._({ id: "Saving", message: "Saving" }) : i18n._({ id: "Done", message: "Done" })} disabled={busy} onClick={() => void finish()}><DoneIcon aria-hidden="true" /></Button>}
          <Button type="button" variant="ghost" size="icon" aria-label={i18n._({ id: "Cancel", message: "Cancel" })} disabled={busy} onClick={() => navigate("/repairs")}><CancelIcon aria-hidden="true" /></Button>
        </div>
      </div>
    </section>
  </div>;
}
