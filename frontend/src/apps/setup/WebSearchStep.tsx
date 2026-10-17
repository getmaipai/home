import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { getIcon } from "@maipai/ui/src/icons";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Field, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { SEARCH_RESULT_ICON, SEARCH_RESULT_VARIANT, SEARCH_ROW_STATE_WORD, type SearchTestResultData } from "@/shell/components/searchTestResult";

const ErrorIcon = getIcon("circle-alert");

const RESULT_ICONS = { pass: getIcon(SEARCH_RESULT_ICON.pass), warn: getIcon(SEARCH_RESULT_ICON.warn), fail: getIcon(SEARCH_RESULT_ICON.fail) };
const SKIP_FAILED = "Home couldn't turn on DuckDuckGo search. Press Skip for now again to go on, or set up web search later in Settings.";

/** The failure as one sentence: what went wrong, then the next step. */
export function webSearchFailure(reason: unknown): string {
  if (reason instanceof ApiError) return [reason.message.replace(/\s+$/, ""), reason.next].filter(Boolean).join(" ");
  return "Home couldn't reach that address. Check it and that the search service is running, then press Test.";
}

export interface WebSearchStepProps {
  /** A SearXNG found on this computer, filled in for the person to Test and Save. */
  candidate?: string | null;
  /** Web search is settled (saved or skipped): the wizard goes on. */
  onFinished: () => void;
  /** The wizard's own Continue runs this, so Continue means the same as Skip for now until an address is saved. */
  continueRef?: MutableRefObject<(() => Promise<void>) | null>;
  test?: (url: string) => Promise<{ saved: boolean; result?: SearchTestResultData }>;
  save?: (url: string) => Promise<unknown>;
  skip?: () => Promise<unknown>;
  /** Tells the wizard whether its footer Continue may be pressed: the field is empty, or the latest Test of this exact text passed. */
  onCanContinue?: (can: boolean) => void;
}

/** SETUP-SEARCH-02: shown only when Home's own web search is not ready. One value line, an address, Test. The wizard's
 * Continue is the only way on: with an empty field it skips SearXNG (DuckDuckGo for adults, owner ruling 2026-10-17);
 * with an address it saves it, and only once the latest Test of that exact text passed. */
export function WebSearchStep({ candidate = null, onFinished, continueRef, test = (url) => api.setupUseSearchCandidate(url, true), save = (url) => api.setupUseSearchCandidate(url), skip = api.setupSkipSearch, onCanContinue }: WebSearchStepProps) {
  const [address, setAddress] = useState(candidate ?? "");
  const [busy, setBusy] = useState<"test" | "save" | "skip" | null>(null);
  const [result, setResult] = useState<SearchTestResultData | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipFailed = useRef(false);

  const trimmed = address.trim();
  const empty = trimmed === "";
  // Passed means the latest Test, of exactly this text, was usable (works or works with warnings).
  const [testedText, setTestedText] = useState<string | null>(null);
  const passed = !empty && result?.canUse === true && testedText === trimmed;
  const changedAfterTest = !empty && result !== null && testedText !== trimmed;
  const canContinue = busy === null && (empty || passed);

  async function runTest() {
    if (empty) return;
    setBusy("test"); setError(null); setResult(null);
    try { setResult((await test(trimmed)).result ?? null); setTestedText(trimmed); }
    catch (reason) { setError(webSearchFailure(reason)); }
    finally { setBusy(null); }
  }
  async function runContinue() {
    if (!canContinue) return;
    if (empty) { await runSkip(); return; }
    setBusy("save"); setError(null);
    try { await save(trimmed); onFinished(); }
    catch (reason) { setError(webSearchFailure(reason)); setBusy(null); }
  }
  async function runSkip() {
    // A skip that could not be saved never traps the person: the second press goes on.
    if (skipFailed.current) { onFinished(); return; }
    setBusy("skip"); setError(null);
    try { await skip(); onFinished(); }
    catch { skipFailed.current = true; setError(SKIP_FAILED); setBusy(null); }
  }
  useEffect(() => {
    if (!continueRef) return;
    continueRef.current = runContinue;
    return () => { continueRef.current = null; };
  });
  useEffect(() => { onCanContinue?.(canContinue); }, [canContinue, onCanContinue]);
  useEffect(() => () => onCanContinue?.(true), [onCanContinue]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted-foreground md:text-lg">SearXNG is a search service you run yourself. It searches many sites at once and keeps no record of who asked.</p>
      <Field>
        <FieldLabel htmlFor="searxng-address">SearXNG address{candidate && address === candidate ? " (found on this computer)" : ""}</FieldLabel>
        <Input id="searxng-address" type="url" inputMode="url" autoComplete="off" placeholder="http://searx.local:8888" value={address} onChange={(event) => { setAddress(event.target.value); setError(null); }} />
      </Field>
      {error ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{error}</AlertDescription></Alert> : null}
      {result && !changedAfterTest ? (() => {
        const Icon = RESULT_ICONS[result.level];
        return (
          <Alert variant={SEARCH_RESULT_VARIANT[result.level]} role="status" data-level={result.level}>
            <Icon aria-hidden="true" />
            <AlertDescription>
              <p className="text-base font-medium text-foreground">{result.headline}</p>
              <p>{result.verdict}</p>
              <p className="font-medium text-foreground">{result.recommendation}</p>
              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger asChild><Button type="button" variant="link" size="sm">{detailsOpen ? "Hide details" : "Details"}</Button></CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="mt-2 flex flex-col gap-1">
                    {result.details.map((row) => <li key={row.id}><span className="font-medium text-foreground">{row.title}: {SEARCH_ROW_STATE_WORD[row.state]}.</span> {row.detail}{row.fix ? ` ${row.fix}` : ""}</li>)}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </AlertDescription>
          </Alert>
        );
      })() : null}
      {changedAfterTest ? <p role="status" className="text-base text-muted-foreground md:text-lg">You changed the address. Test it again, or clear it to skip.</p> : null}
      {!result && !empty && !error ? <p className="text-base text-muted-foreground md:text-lg">Press Test to check this address. Continue turns on once it works.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="lg" disabled={empty || busy !== null} onClick={() => void runTest()}>{result && !changedAfterTest ? (result.canUse ? "Test again" : "Try again") : "Test"}</Button>
      </div>
      <p className="text-base text-muted-foreground md:text-lg">To skip SearXNG, leave the address empty and press Continue. That turns on DuckDuckGo search for adults. You can change this in Settings.</p>
    </div>
  );
}
