// SEARXNG-SET-05: Settings > Home > Search > Web search. One plain page for owners and admins: what web search uses right
// now, the SearXNG address (Test, then Save), the source switches, and the DuckDuckGo choice for teens and children.
// The Test result is the same component the setup screen uses.
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getIcon } from "@maipai/ui/src/icons";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Field, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Switch } from "@maipai/ui/src/dashboard/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { api, type WebSearchState } from "@/lib/api";
import { SEARCH_RESULT_VARIANT, type SearchTestResultData } from "@/shell/components/searchTestResult";
import { SearchResultIcon, SearchTestResultBody } from "@/shell/components/SearchTestResultBody";
import { webSearchFailure } from "@/apps/setup/WebSearchStep";

const ErrorIcon = getIcon("circle-alert");

type Source = "searxng" | "ddgs";

function hostOf(address: string): string {
  try { return new URL(address).host; } catch { return address; }
}

/** What web search uses right now, in plain words. */
export function webSearchStatusLine(state: WebSearchState): string {
  const parts: string[] = [];
  if (state.sources.includes("searxng")) {
    if (state.address) {
      const host = hostOf(state.address);
      parts.push(state.works === true ? `SearXNG at ${host} works` : state.works === false ? `SearXNG at ${host} is not answering` : `SearXNG at ${host}`);
    } else if (state.stackOwned) parts.push("Home's own search service");
  }
  if (state.sources.includes("ddgs") && state.ddgsReady) parts.push("DuckDuckGo (adults only)");
  return parts.length ? parts.join(", and ") : "Library only";
}

export interface WebSearchSettingsProps {
  load?: () => Promise<WebSearchState>;
  test?: (url: string) => Promise<{ saved: boolean; result?: SearchTestResultData }>;
  save?: (url: string) => Promise<unknown>;
  setSources?: (sources: Source[]) => Promise<unknown>;
  /** The DuckDuckGo choice for teens and children (the registry row with its warning). Shown only while DuckDuckGo is set up. */
  minorsControl?: ReactNode;
}

export function WebSearchSettings({ load = api.searchWeb, test = (url) => api.searchAddress(url, true), save = (url) => api.searchAddress(url), setSources = (sources) => api.setSetting("household", "search.web_sources", sources), minorsControl }: WebSearchSettingsProps) {
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ["search-web"], queryFn: load });
  const data = state.data;
  const saved = data?.address ?? "";
  const [address, setAddress] = useState<string | null>(null);
  const text = address ?? saved;
  const trimmed = text.trim();
  const empty = trimmed === "";
  const [busy, setBusy] = useState<"test" | "save" | "source" | null>(null);
  const [result, setResult] = useState<SearchTestResultData | null>(null);
  const [testedText, setTestedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { setAddress(null); }, [saved]);

  const passed = !empty && result?.canUse === true && testedText === trimmed;
  const changedAfterTest = !empty && result !== null && testedText !== trimmed;
  const unchanged = trimmed === saved;
  // Save turns on for a tested address that differs from the saved one, or for clearing a saved address.
  const canSave = busy === null && !unchanged && (empty || passed);

  async function runTest() {
    if (empty) return;
    setBusy("test"); setError(null); setResult(null);
    try { setResult((await test(trimmed)).result ?? null); setTestedText(trimmed); }
    catch (reason) { setError(webSearchFailure(reason)); }
    finally { setBusy(null); }
  }
  async function runSave() {
    setBusy("save"); setError(null); setConfirmClear(false);
    try {
      await save(trimmed);
      setResult(null); setTestedText(null);
      await queryClient.invalidateQueries({ queryKey: ["search-web"] });
    } catch (reason) { setError(webSearchFailure(reason)); }
    finally { setBusy(null); }
  }
  async function toggle(source: Source, on: boolean) {
    if (!data) return;
    const next = (["searxng", "ddgs"] as Source[]).filter((id) => (id === source ? on : data.sources.includes(id)));
    if (next.length === 0) return;
    setBusy("source"); setError(null);
    try { await setSources(next); await queryClient.invalidateQueries({ queryKey: ["search-web"] }); }
    catch (reason) { setError(webSearchFailure(reason)); }
    finally { setBusy(null); }
  }

  if (state.isError) return <section aria-label="Web search"><Alert variant="destructive"><ErrorIcon /><AlertDescription>Home could not read the web search settings. Reload the page, and check that Home is running.</AlertDescription></Alert></section>;
  if (!data) return null;

  const clearing = empty && saved !== "";
  const only = data.sources.length === 1 ? data.sources[0] : null;
  return (
    <section aria-label="Web search" className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-foreground">Web search</h2>
      <p role="status" data-testid="web-search-status" className="text-base text-foreground">{webSearchStatusLine(data)}</p>
      <p className="text-base text-muted-foreground">SearXNG is a search service you run yourself. It is private, keeps no record of who asked, and searches many sites at once.</p>
      <Field>
        <FieldLabel htmlFor="searxng-address">SearXNG address</FieldLabel>
        <Input id="searxng-address" type="url" inputMode="url" autoComplete="off" placeholder="http://searx.local:8888" value={text} onChange={(event) => { setAddress(event.target.value); setError(null); }} />
      </Field>
      {error ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{error}</AlertDescription></Alert> : null}
      {result && !changedAfterTest ? <Alert variant={SEARCH_RESULT_VARIANT[result.level]} role="status" data-level={result.level}><SearchResultIcon level={result.level} /><AlertDescription><SearchTestResultBody result={result} /></AlertDescription></Alert> : null}
      {changedAfterTest ? <p role="status" className="text-base text-muted-foreground">You changed the address. Test it again, or clear it.</p> : null}
      {!result && !empty && !unchanged && !error ? <p className="text-base text-muted-foreground">Press Test to check this address. Save turns on once it works.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="lg" disabled={empty || busy !== null} onClick={() => void runTest()}>{result && !changedAfterTest ? (result.canUse ? "Test again" : "Try again") : "Test"}</Button>
        <Button type="button" size="lg" disabled={!canSave} onClick={() => (clearing ? setConfirmClear(true) : void runSave())}>{clearing ? "Remove SearXNG" : "Save"}</Button>
      </div>
      {data.ddgsReady ? (
        <ItemGroup variant="card" aria-label="Search sources">
          <Item size="setting">
            <ItemContent><ItemTitle>SearXNG</ItemTitle></ItemContent>
            <ItemActions><Switch size="md" aria-label="Use SearXNG" checked={data.sources.includes("searxng")} disabled={busy !== null || only === "searxng"} onCheckedChange={(on) => void toggle("searxng", on)} /></ItemActions>
          </Item>
          <Item size="setting">
            <ItemContent>
              <ItemTitle>DuckDuckGo</ItemTitle>
              <ItemDescription>Adults only.</ItemDescription>
            </ItemContent>
            <ItemActions><Switch size="md" aria-label="Use DuckDuckGo" checked={data.sources.includes("ddgs")} disabled={busy !== null || only === "ddgs"} onCheckedChange={(on) => void toggle("ddgs", on)} /></ItemActions>
          </Item>
        </ItemGroup>
      ) : null}
      {data.ddgsReady ? minorsControl : null}
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove SearXNG?</AlertDialogTitle>
            <AlertDialogDescription>{data.ddgsReady && data.sources.includes("ddgs") ? "Home will use DuckDuckGo for adults and the Library only for teens and children." : "Home will use the Library only until you add a SearXNG address."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runSave()}>Remove SearXNG</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
