import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/ui/button";
import { runMicTest, micTestText, type MicTestResult } from "@/lib/voice/micTest";
import { queryMicPermission, safariTipDue, SAFARI_ASK_TIP } from "@/lib/media/micPermission";
import { copyText } from "@/lib/voice/micDiagnostics";
import { useTabItem } from "@/shell/tabIdentity";

const LABEL = { pass: "PASS", fail: "FAIL", skip: "SKIP" } as const;

/** Hidden diagnostics page (/mic-test, not in the menu): runs each microphone
 * step in turn from one click and shows PASS or FAIL with the browser's error. */
export function MicTestPage() {
  useTabItem("Microphone test");
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
        <CardHeader><CardTitle>Microphone test</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">Click the button, allow the microphone if asked, and say a few words when the last step runs. Then take a screenshot or copy the results.</p>
            {safariTip ? <p className="text-sm text-muted-foreground">{SAFARI_ASK_TIP}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={start} disabled={running}>{running ? "Running..." : "Run microphone test"}</Button>
              <Button variant="outline" disabled={results.length === 0} onClick={() => void copyText(micTestText(results)).then((ok) => toast(ok ? "Results copied." : "Could not copy. Select the text instead."))}>Copy results</Button>
            </div>
            {running ? <p className="text-sm text-muted-foreground">Level: {(peak * 100).toFixed(0)} percent</p> : null}
            <ol aria-label="Microphone test results" className="flex flex-col gap-2">
              {results.map((result) => (
                <li key={result.id} data-status={result.status} className="min-w-0 text-sm">
                  <span className="font-semibold">{LABEL[result.status]}</span> {result.label}
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
