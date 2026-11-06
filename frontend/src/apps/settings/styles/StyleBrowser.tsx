// VIDEO-LORA-08 (settings-media 5.2, video-loras 15.3, Loki Doki's LoraManager rebuilt from kit parts): the Browse styles dialog. Search with a 300 ms pause, Type, Made for,
// Installed and Source filters, Sort, Previous / numbered / Next paging (the cursor of each visited page is kept), a one-line reason on every tile, and ONE lock tile for every
// adult or unknown hit (the hub sends no title, picture or id for them; nothing here ever blurs). "Show adult results" exists only while unlocked and is off at each visit.
// A tile opens the confirm panel; a pasted Hugging Face link opens it directly. The hub makes every outbound request; this dialog only talks to Home.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { MediaShelf } from "@maipai/ui/src/primitives/MediaShelf";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { useLockProof } from "@maipai/ui/src/elements/adult-lock";
import { ApiError, type Roster } from "@/lib/api";
import { StyleConfirm } from "@/apps/settings/styles/StyleConfirm";
import { stylesApi, type BrowseHit, type BrowsePage, type BrowseQuery, type BrowseSource } from "@/apps/settings/styles/stylesApi";
import { messageOf, StylePicture } from "@/apps/settings/styles/stylesShared";

type Tile = BrowseHit | { locked: true };
const isLockedTile = (tile: Tile): tile is { locked: true } => (tile as { locked?: boolean }).locked === true;

/** A hit the household already has (by source version or fingerprint): the tile opens that style instead of starting another download (design 15.4). */
const alreadyHave = (hit: BrowseHit): boolean => hit.installed !== null || hit.reason?.startsWith("Already installed") === true;

const LICENCE_BADGE = { open: "Open licence", non_commercial: "No selling", custom: "Custom licence", unknown: "Licence not stated" } as const;
const HF_LINK = /^https?:\/\/(?:www\.)?huggingface\.co\/([^/\s?#]+)\/([^/\s?#]+)/i;

/** The plain line for each way the search can fail (settings-media 5.2). Every one says what went wrong and what to do. */
export function browseProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Searching too fast. Try again in a minute.";
    if (error.status === 503) return "The source asked Home to slow down. Try again in a few minutes.";
    if (error.status === 502) return "The source did not answer. Check your connection, then search again.";
    if (error.status === 403) return error.message;
    return error.message;
  }
  return "Home could not search just now. Check the Home connection, then try again.";
}

export function StyleBrowser({ person, civitaiOn, onClose, onInstalled, onOpenStyle }: {
  person: Roster; civitaiOn: boolean; onClose: () => void; onInstalled: () => void; onOpenStyle: (id: string | null) => void;
}) {
  const lock = useLockProof();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [source, setSource] = useState<BrowseSource>("huggingface");
  const [kind, setKind] = useState<BrowseQuery["kind"]>("any");
  const [base, setBase] = useState<BrowseQuery["base"]>("default");
  const [installed, setInstalled] = useState<BrowseQuery["installed"]>("any");
  const [sort, setSort] = useState<BrowseQuery["sort"]>("downloads");
  const [adult, setAdult] = useState(false);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<BrowseHit | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const first = useRef(true);

  // The adult switch is off at each visit and ends with the unlock.
  useEffect(() => { if (!lock.unlocked) setAdult(false); }, [lock.unlocked]);
  // A search box pause of 300 ms before the first page (Loki Doki's LoraManager).
  useEffect(() => {
    if (first.current) { first.current = false; setQ(typed.trim()); return; }
    const timer = window.setTimeout(() => setQ(typed.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [typed]);
  // Any change of what is asked starts again at page one.
  useEffect(() => { setCursors([null]); setPage(0); }, [q, source, kind, base, installed, sort, adult]);

  const link = HF_LINK.exec(q);
  const query: BrowseQuery = { source, q, kind, base, installed, sort, cursor: cursors[page] ?? null, adult: adult && lock.unlocked };
  const results = useQuery<BrowsePage>({
    queryKey: ["style-browse", query, lock.unlocked], queryFn: () => stylesApi.browse(query), enabled: !link, staleTime: 5 * 60_000, retry: false,
    placeholderData: (previous) => previous,
  });
  // Remember where the next page starts.
  useEffect(() => {
    const next = results.data?.next_cursor;
    if (results.data && next && cursors[page + 1] !== next) setCursors((all) => { const copy = all.slice(0, page + 1); copy[page + 1] = next; return copy; });
  }, [results.data, page, cursors]);

  // A pasted Hugging Face link opens that style's confirm panel directly.
  useEffect(() => {
    if (!link) { setLinkError(null); return; }
    let alive = true;
    setLinkError(null);
    void stylesApi.hit("huggingface", `${link[1]}/${link[2]!.replace(/\.git$/, "")}`, null).then((hit) => { if (alive) setPicked(hit); }).catch((error: unknown) => { if (alive) setLinkError(messageOf(error, "Home could not read that link. Check it, then paste it again.")); });
    return () => { alive = false; };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const tiles: Tile[] = useMemo(() => [...(results.data?.items ?? []), ...(results.data?.locked ? [{ locked: true as const }] : [])], [results.data]);
  const hasMore = Boolean(results.data?.next_cursor);
  const empty = results.data && results.data.items.length === 0 && !results.data.locked;

  const filters = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Pick id="style-filter-type" label="Type" value={kind} onChange={(v) => setKind(v as typeof kind)} options={[["any", "Any"], ["style", "Style"], ["character", "Character"]]} />
      <Pick id="style-filter-base" wide label="Made for" value={base} onChange={(v) => setBase(v as typeof base)} options={[["default", "LTX-2.5 and Wan"], ["ltx-2.5", "LTX-2.5"], ["wan", "Wan"], ["all", "All"]]} />
      <Pick id="style-filter-installed" label="Installed" value={installed} onChange={(v) => setInstalled(v as typeof installed)} options={[["any", "Any"], ["not_installed", "Not installed"], ["installed", "Installed"]]} />
      <Pick id="style-filter-source" label="Source" value={source} onChange={(v) => setSource(v as BrowseSource)} options={[["huggingface", "Hugging Face"], ["civitai", civitaiOn ? "Civitai" : "Civitai (off)", !civitaiOn], ["both", "Both", !civitaiOn]]} />
      <Pick id="style-filter-sort" label="Sort" value={sort} onChange={(v) => setSort(v as typeof sort)} options={[["downloads", "Most downloaded"], ["rating", "Top rated"], ["newest", "Newest"]]} />
    </div>
  );

  return (
    <>
      <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent variant="flow" size="xl" aria-describedby="style-browse-desc" onInteractOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle size="xl">Browse styles</DialogTitle>
            <DialogDescription id="style-browse-desc">Home searches for you. Nothing is downloaded until you press Install style.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="style-search">Search styles, or paste a Hugging Face link</Label>
              <Input id="style-search" type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="old film, clay, anime" />
            </div>
            {filters}
            {lock.unlocked ? (
              <div className="flex items-center gap-3">
                <Switch id="style-adult-results" checked={adult} onCheckedChange={setAdult} aria-label="Show adult results" />
                <Label htmlFor="style-adult-results">Show adult results</Label>
              </div>
            ) : null}
            {results.data?.notes.map((note) => <p key={note} className="text-sm text-muted-foreground">{note}</p>)}
            {linkError ? <p role="alert" className="text-sm text-destructive">{linkError}</p> : null}
            {link ? null : results.isError && !results.data ? (
              <div role="alert" className="flex flex-col items-start gap-2 text-sm"><p className="text-destructive">{browseProblem(results.error)}</p><Button type="button" variant="outline" size="sm" onClick={() => void results.refetch()}>Try again</Button></div>
            ) : (
              <AsyncState data={results.data} error={false} isFetching={results.isFetching} onRetry={() => void results.refetch()} loadingLabel="Searching for styles" errorMessage="">
                {() => empty ? <p className="text-sm text-muted-foreground">No styles match. Try fewer words.</p> : (
                  <MediaShelf<Tile>
                    label="Styles from the source" items={tiles} variant="plain" layout="grid" aspect="wide" density="compact"
                    getKey={(tile) => (isLockedTile(tile) ? "locked" : tile.key)} isLocked={isLockedTile} onUnlock={() => lock.requestUnlock()}
                    getLabel={(tile) => (isLockedTile(tile) ? "Locked items" : tile.title)}
                    onSelect={(tile) => { if (isLockedTile(tile)) return; if (alreadyHave(tile)) onOpenStyle(tile.installed?.id ?? null); else setPicked(tile); }}
                    renderItem={(tile) => (isLockedTile(tile) ? null : <StylePicture path={tile.preview} proof={tile.adult_check !== "normal"} />)}
                    renderBadge={(tile) => (isLockedTile(tile) ? null : <Badge variant="secondary">{LICENCE_BADGE[tile.licence.class]}</Badge>)}
                    renderCaption={(tile) => (isLockedTile(tile) ? null : (
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-semibold">{tile.title}</span>
                        {tile.creator ? <span className="truncate text-sm text-muted-foreground">{tile.creator}</span> : null}
                        <span className="text-sm text-muted-foreground">{alreadyHave(tile) ? (tile.installed ? `Already added as ${tile.installed.name}. Press to open it.` : "You already have this style. Press to open it.") : tile.reason ?? tile.line}</span>
                        {tile.also_on.length ? <span className="text-sm text-muted-foreground">Also on {tile.also_on.join(" and ")}</span> : null}
                      </span>
                    ))}
                  />
                )}
              </AsyncState>
            )}
            {link ? null : (
              <nav aria-label="Pages of results" className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>Previous</Button>
                {cursors.map((_, index) => <Button key={index} type="button" variant={index === page ? "default" : "ghost"} size="sm" aria-current={index === page ? "page" : undefined} onClick={() => setPage(index)}>{index + 1}</Button>)}
                <Button type="button" variant="outline" size="sm" disabled={!hasMore} onClick={() => setPage((n) => n + 1)}>Next</Button>
              </nav>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {picked ? <StyleConfirm hit={picked} person={person} revealed={picked.adult_check !== "normal"} onClose={() => setPicked(null)} onInstalled={() => { setPicked(null); onInstalled(); }} onOpenInstalled={(id) => { setPicked(null); onOpenStyle(id); }} /> : null}
    </>
  );
}

function Pick({ id, label, value, onChange, options, wide }: { id: string; label: string; wide?: boolean; value: string; onChange: (value: string) => void; options: Array<[string, string, boolean?]> }) {
  return (
    <div className={wide ? "col-span-2 flex min-w-0 flex-col gap-1.5 lg:col-span-1" : "flex min-w-0 flex-col gap-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([v, text, disabled]) => <SelectItem key={v} value={v} disabled={disabled}>{text}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
