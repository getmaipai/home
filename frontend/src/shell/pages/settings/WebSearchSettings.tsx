// SEARXNG-SET-05: Settings > Home > Search > Web search. One plain page for owners and admins: what web search uses right
// now, the SearXNG address (Test, then Save), the source switches, and the DuckDuckGo choice for teens and children.
// The Test result is the same component the setup screen uses.
import { i18n } from "@lingui/core";
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
import { useSearchAddress, webSearchFailure } from "@/apps/settings/useSearchAddress";

const ErrorIcon = getIcon("alert-triangle");

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
      parts.push(state.works === true ? i18n._({ id: "SearXNG at {host} works", message: "SearXNG at {host} works", values: { host } }) : state.works === false ? i18n._({ id: "SearXNG at {host} is not answering", message: "SearXNG at {host} is not answering", values: { host } }) : i18n._({ id: "SearXNG at {host}", message: "SearXNG at {host}", values: { host } }));
    } else if (state.stackOwned) parts.push(i18n._({ id: "Home's own search service", message: "Home's own search service" }));
  }
  if (state.sources.includes("ddgs") && state.ddgsReady) parts.push(i18n._({ id: "DuckDuckGo (adults only)", message: "DuckDuckGo (adults only)" }));
  if (parts.length === 2) return i18n._({ id: "{first}, and {second}", message: "{first}, and {second}", values: { first: parts[0], second: parts[1] } });
  return parts[0] ?? i18n._({ id: "Library only", message: "Library only" });
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
  const { text, trimmed, empty, busy, setBusy, result, error, setError, passed, changedAfterTest, type, resetTyped, forgetTest, runTest } = useSearchAddress<"save" | "source">(saved, test);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { resetTyped(); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const unchanged = trimmed === saved;
  // Save turns on for a tested address that differs from the saved one, or for clearing a saved address.
  const canSave = busy === null && !unchanged && (empty || passed);

  async function runSave() {
    setBusy("save"); setError(null); setConfirmClear(false);
    try {
      await save(trimmed);
      forgetTest();
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

  if (state.isError) return <section aria-label={i18n._({ id: "Web search", message: "Web search" })}><Alert variant="destructive"><ErrorIcon /><AlertDescription>{i18n._({ id: "Home could not read the web search settings. Reload the page, and check that Home is running.", message: "Home could not read the web search settings. Reload the page, and check that Home is running." })}</AlertDescription></Alert></section>;
  if (!data) return null;

  const clearing = empty && saved !== "";
  const only = data.sources.length === 1 ? data.sources[0] : null;
  return (
    <section aria-label={i18n._({ id: "Web search", message: "Web search" })} className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-foreground">{i18n._({ id: "Web search", message: "Web search" })}</h2>
      <p role="status" data-testid="web-search-status" className="text-base text-foreground">{webSearchStatusLine(data)}</p>
      <p className="text-base text-muted-foreground">{i18n._({ id: "SearXNG is a search service you run yourself. It is private, keeps no record of who asked, and searches many sites at once.", message: "SearXNG is a search service you run yourself. It is private, keeps no record of who asked, and searches many sites at once." })}</p>
      <Field>
        <FieldLabel htmlFor="searxng-address">{i18n._({ id: "SearXNG address", message: "SearXNG address" })}</FieldLabel>
        <Input id="searxng-address" type="url" inputMode="url" autoComplete="off" placeholder={i18n._({ id: "http://searx.local:8888", message: "http://searx.local:8888" })} value={text} onChange={(event) => type(event.target.value)} />
      </Field>
      {error ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{error}</AlertDescription></Alert> : null}
      {result && !changedAfterTest ? <Alert variant={SEARCH_RESULT_VARIANT[result.level]} role="status" data-level={result.level}><SearchResultIcon level={result.level} /><AlertDescription><SearchTestResultBody result={result} /></AlertDescription></Alert> : null}
      {changedAfterTest ? <p role="status" className="text-base text-muted-foreground">{i18n._({ id: "You changed the address. Test it again, or clear it.", message: "You changed the address. Test it again, or clear it." })}</p> : null}
      {!result && !empty && !unchanged && !error ? <p className="text-base text-muted-foreground">{i18n._({ id: "Press Test to check this address. Save turns on once it works.", message: "Press Test to check this address. Save turns on once it works." })}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="lg" disabled={empty || busy !== null} onClick={() => void runTest()}>{result && !changedAfterTest ? (result.canUse ? i18n._({ id: "Test again", message: "Test again" }) : i18n._({ id: "Try again", message: "Try again" })) : i18n._({ id: "Test", message: "Test" })}</Button>
        <Button type="button" size="lg" disabled={!canSave} onClick={() => (clearing ? setConfirmClear(true) : void runSave())}>{clearing ? i18n._({ id: "Remove SearXNG", message: "Remove SearXNG" }) : i18n._({ id: "Save", message: "Save" })}</Button>
      </div>
      {data.ddgsReady ? (
        <ItemGroup variant="card" aria-label={i18n._({ id: "Search sources", message: "Search sources" })}>
          <Item size="setting">
            <ItemContent><ItemTitle>{i18n._({ id: "SearXNG", message: "SearXNG" })}</ItemTitle></ItemContent>
            <ItemActions><Switch size="md" aria-label={i18n._({ id: "Use SearXNG", message: "Use SearXNG" })} checked={data.sources.includes("searxng")} disabled={busy !== null || only === "searxng"} onCheckedChange={(on) => void toggle("searxng", on)} /></ItemActions>
          </Item>
          <Item size="setting">
            <ItemContent>
              <ItemTitle>{i18n._({ id: "DuckDuckGo", message: "DuckDuckGo" })}</ItemTitle>
              <ItemDescription>{i18n._({ id: "Adults only.", message: "Adults only." })}</ItemDescription>
            </ItemContent>
            <ItemActions><Switch size="md" aria-label={i18n._({ id: "Use DuckDuckGo", message: "Use DuckDuckGo" })} checked={data.sources.includes("ddgs")} disabled={busy !== null || only === "ddgs"} onCheckedChange={(on) => void toggle("ddgs", on)} /></ItemActions>
          </Item>
        </ItemGroup>
      ) : null}
      {data.ddgsReady ? minorsControl : null}
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n._({ id: "Remove SearXNG?", message: "Remove SearXNG?" })}</AlertDialogTitle>
            <AlertDialogDescription>{data.ddgsReady && data.sources.includes("ddgs") ? i18n._({ id: "Home will use DuckDuckGo for adults and the Library only for teens and children.", message: "Home will use DuckDuckGo for adults and the Library only for teens and children." }) : i18n._({ id: "Home will use the Library only until you add a SearXNG address.", message: "Home will use the Library only until you add a SearXNG address." })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{i18n._({ id: "Keep it", message: "Keep it" })}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runSave()}>{i18n._({ id: "Remove SearXNG", message: "Remove SearXNG" })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
