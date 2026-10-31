import { useEffect, useState } from "react";
import { getIcon } from "@maipai/ui/src/icons";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { useNavigate } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { renderSetupReviewScreen } from "./SetupWizard";

const ErrorIcon = getIcon("circle-alert");

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
      else setError("Home couldn't load these setup choices. Refresh this page and try again.");
    });
  }, [navigate]);

  async function finish() {
    setBusy(true); setError(null);
    try {
      if (engine !== originalEngine) await api.setSetting("household", "engines.stack.where", engine);
      navigate("/repairs", { replace: true });
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Home couldn't save this choice. Check the engine link in Home settings, then try again.");
    } finally { setBusy(false); }
  }

  return <div>
    <Card>
      <CardHeader><CardTitle>Setup review</CardTitle></CardHeader>
      <CardContent>
        <p>Review your computers, files, checks, and plan.</p>
        {renderSetupReviewScreen({ screen, engine, onEngineChange: setEngine, readOnly: screen === "storage", checkRows: rows, checkError, onRetryChecks: () => void refreshChecks() })}
        {error ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{error}</AlertDescription></Alert> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" disabled={screenIndex === 0 || busy} onClick={() => setScreenIndex((index) => index - 1)}>Back</Button>
          {screenIndex < REVIEW_SCREENS.length - 1 ? <Button type="button" disabled={busy} onClick={() => setScreenIndex((index) => index + 1)}>Continue</Button> : <Button type="button" disabled={busy} onClick={() => void finish()}>{busy ? "Saving" : "Done"}</Button>}
          <Button type="button" variant="link" disabled={busy} onClick={() => navigate("/repairs")}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  </div>;
}
