import { i18n } from "@lingui/core";
import { useEffect, useRef, type MutableRefObject } from "react";
import { getIcon } from "@maipai/ui/src/icons";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Field, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { api } from "@/lib/api";
import { SEARCH_RESULT_VARIANT, type SearchTestResultData } from "@/shell/components/searchTestResult";
import { SearchResultIcon, SearchTestResultBody } from "@/shell/components/SearchTestResultBody";
import { useSearchAddress, webSearchFailure } from "@/apps/settings/useSearchAddress";

const ErrorIcon = getIcon("alert-triangle");

const skipFailedCopy = () => i18n._({ id: "Home couldn't turn on DuckDuckGo search. Press Skip for now again to go on, or set up web search later in Settings.", message: "Home couldn't turn on DuckDuckGo search. Press Skip for now again to go on, or set up web search later in Settings." });


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
  const { text: address, trimmed, empty, busy, setBusy, result, error, setError, passed, changedAfterTest, type, runTest } = useSearchAddress<"save" | "skip">(candidate ?? "", test);
  const skipFailed = useRef(false);
  const canContinue = busy === null && (empty || passed);

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
    catch { skipFailed.current = true; setError(skipFailedCopy()); setBusy(null); }
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
      <p className="text-base text-muted-foreground md:text-lg">{i18n._({ id: "SearXNG is a search service you run yourself. It searches many sites at once and keeps no record of who asked.", message: "SearXNG is a search service you run yourself. It searches many sites at once and keeps no record of who asked." })}</p>
      <Field>
        <FieldLabel htmlFor="searxng-address">{candidate && address === candidate ? i18n._({ id: "SearXNG address (found on this computer)", message: "SearXNG address (found on this computer)" }) : i18n._({ id: "SearXNG address", message: "SearXNG address" })}</FieldLabel>
        <Input id="searxng-address" type="url" inputMode="url" autoComplete="off" placeholder={i18n._({ id: "http://searx.local:8888", message: "http://searx.local:8888" })} value={address} onChange={(event) => type(event.target.value)} />
      </Field>
      {error ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{error}</AlertDescription></Alert> : null}
      {result && !changedAfterTest ? <Alert variant={SEARCH_RESULT_VARIANT[result.level]} role="status" data-level={result.level}><SearchResultIcon level={result.level} /><AlertDescription><SearchTestResultBody result={result} /></AlertDescription></Alert> : null}
      {changedAfterTest ? <p role="status" className="text-base text-muted-foreground md:text-lg">{i18n._({ id: "You changed the address. Test it again, or clear it to skip.", message: "You changed the address. Test it again, or clear it to skip." })}</p> : null}
      {!result && !empty && !error ? <p className="text-base text-muted-foreground md:text-lg">{i18n._({ id: "Press Test to check this address. Continue turns on once it works.", message: "Press Test to check this address. Continue turns on once it works." })}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="lg" disabled={empty || busy !== null} onClick={() => void runTest()}>{result && !changedAfterTest ? (result.canUse ? i18n._({ id: "Test again", message: "Test again" }) : i18n._({ id: "Try again", message: "Try again" })) : i18n._({ id: "Test", message: "Test" })}</Button>
      </div>
      <p className="text-base text-muted-foreground md:text-lg">{i18n._({ id: "To skip SearXNG, leave the address empty and press Continue. That turns on DuckDuckGo search for adults. Until SearXNG is set up, teens and children use the Library only. You can allow DuckDuckGo for them in Settings, Web search.", message: "To skip SearXNG, leave the address empty and press Continue. That turns on DuckDuckGo search for adults. Until SearXNG is set up, teens and children use the Library only. You can allow DuckDuckGo for them in Settings, Web search." })}</p>
    </div>
  );
}
