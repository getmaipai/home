import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/ui/button";
import { runMicTest, micTestText, type MicTestResult } from "@/lib/voice/micTest";
import { queryMicPermission, safariTipDue, SAFARI_ASK_TIP } from "@/lib/media/micPermission";
import { copyText } from "@/lib/voice/micDiagnostics";
import { useTabItem } from "@/shell/tabIdentity";

const statusLabel = (status: MicTestResult["status"]): string => ({ pass: i18n._({ id: "PASS", message: "PASS" }), fail: i18n._({ id: "FAIL", message: "FAIL" }), skip: i18n._({ id: "SKIP", message: "SKIP" }) })[status];

/** Hidden diagnostics page (/mic-test, not in the menu): runs each microphone
 * step in turn from one click and shows PASS or FAIL with the browser's error. */
export function MicTestPage() {
  useTabItem(i18n._({ id: "Microphone test", message: "Microphone test" }));
  const [results, setResults] = useState<MicTestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [peak, setPeak] = useState(0);
  const resultsRef = useRef<MicTestResult[]>([]);
  const [safariTip, setSafariTip] = useState(false);
  useEffect(() => {
    let alive = true;
    void queryMicPermission().then((state) => { if (alive) setSafariTip(safariTipDue(state, navigator.userAgent, false)); });
    return () => { alive = false; };
  }, []);

  const start = () => {
    if (running) return;
    resultsRef.current = [];
    setResults([]);
    setPeak(0);
    setRunning(true);
    void runMicTest(
      (result) => { resultsRef.current = [...resultsRef.current, result]; setResults(resultsRef.current); },
      (value) => setPeak(value),
    ).finally(() => setRunning(false));
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>{i18n._({ id: "Microphone test", message: "Microphone test" })}</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{i18n._({ id: "Click the button, allow the microphone if asked, and say a few words when the last step runs. Then take a screenshot or copy the results.", message: "Click the button, allow the microphone if asked, and say a few words when the last step runs. Then take a screenshot or copy the results." })}</p>
            {safariTip ? <p className="text-sm text-muted-foreground">{SAFARI_ASK_TIP}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={start} disabled={running}>{running ? i18n._({ id: "Running...", message: "Running..." }) : i18n._({ id: "Run microphone test", message: "Run microphone test" })}</Button>
              <Button variant="outline" disabled={results.length === 0} onClick={() => void copyText(micTestText(results)).then((ok) => toast(ok ? i18n._({ id: "Results copied.", message: "Results copied." }) : i18n._({ id: "Could not copy. Select the text instead.", message: "Could not copy. Select the text instead." })))}>{i18n._({ id: "Copy results", message: "Copy results" })}</Button>
            </div>
            {running ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Level: {toFixed} percent", message: "Level: {toFixed} percent", values: { toFixed: (peak * 100).toFixed(0) } })}</p> : null}
            <ol aria-label={i18n._({ id: "Microphone test results", message: "Microphone test results" })} className="flex flex-col gap-2">
              {results.map((result) => (
                <li key={result.id} data-status={result.status} className="min-w-0 text-sm">
                  <span className="font-semibold">{statusLabel(result.status)}</span> {result.label}
                  {result.detail ? <span className="block break-words whitespace-pre-wrap text-xs text-muted-foreground">{result.detail}</span> : null}
                </li>
              ))}
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
