import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Field, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { api, ApiError } from "@/lib/api";

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
  test?: (url: string) => Promise<unknown>;
  save?: (url: string) => Promise<unknown>;
  skip?: () => Promise<unknown>;
}

/** SETUP-SEARCH-02: shown only when Home's own web search is not ready. One value line, an address, Test, Save,
 * Skip for now. Skipping leaves SearXNG unset and turns on DuckDuckGo for adults (owner ruling 2026-10-17). */
export function WebSearchStep({ candidate = null, onFinished, continueRef, test = (url) => api.setupUseSearchCandidate(url, true), save = (url) => api.setupUseSearchCandidate(url), skip = api.setupSkipSearch }: WebSearchStepProps) {
  const [address, setAddress] = useState(candidate ?? "");
  const [busy, setBusy] = useState<"test" | "save" | "skip" | null>(null);
  const [passed, setPassed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipFailed = useRef(false);

  async function runTest() {
    setBusy("test"); setError(null); setPassed(false);
    try { await test(address.trim()); setPassed(true); }
    catch (reason) { setError(webSearchFailure(reason)); }
    finally { setBusy(null); }
  }
  async function runSave() {
    setBusy("save"); setError(null);
    try { await save(address.trim()); onFinished(); }
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
    continueRef.current = runSkip;
    return () => { continueRef.current = null; };
  });

  const empty = address.trim() === "";
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted-foreground md:text-lg">SearXNG is a search service you run yourself. It searches many sites at once and keeps no record of who asked.</p>
      <Field>
        <FieldLabel htmlFor="searxng-address">SearXNG address{candidate && address === candidate ? " (found on this computer)" : ""}</FieldLabel>
        <Input id="searxng-address" type="url" inputMode="url" autoComplete="off" placeholder="http://searx.local:8888" value={address} onChange={(event) => { setAddress(event.target.value); setPassed(false); setError(null); }} />
      </Field>
      {error ? <p role="alert">{error}</p> : null}
      {passed ? <p role="status" className="text-base text-muted-foreground md:text-lg">That works. Press Save to use it.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="lg" disabled={empty || busy !== null} onClick={() => void runTest()}>Test</Button>
        <Button type="button" size="lg" disabled={empty || busy !== null} onClick={() => void runSave()}>Save</Button>
        <Button type="button" variant="ghost" size="lg" disabled={busy !== null} onClick={() => void runSkip()}>Skip for now</Button>
      </div>
      <p className="text-base text-muted-foreground md:text-lg">Skipping turns on DuckDuckGo search for adults. You can change this in Settings.</p>
    </div>
  );
}
