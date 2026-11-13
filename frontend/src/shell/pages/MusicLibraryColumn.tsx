import { i18n } from "@lingui/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { Cover } from "@maipai/ui/src/ui/media-tiles";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Skeleton } from "@maipai/ui/src/ui/skeleton";
import { SectionSidebar } from "@maipai/ui/src/primitives/SectionSidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@maipai/ui/src/ui/tooltip";
import { getIcon } from "@maipai/ui/src/icons";
import { api, requestJson } from "@/lib/api";

type MusicLibraryEntry = {
  id?: string;
  title?: string;
  channel?: string | null;
  thumbnail?: string | null;
  route?: string;
  kind_label?: string;
  pin_key?: string;
  pinned?: boolean;
  is_song?: boolean;
};
type LibrarySort = "recents" | "az" | "creator";
type LibraryKind = "all" | "songs" | "albums" | "artists" | "playlists" | "downloaded" | "styles" | "sounds";

const FILTERS: Array<{ value: LibraryKind; label: string; apiKind?: string }> = [
  { value: "songs", label: i18n._({ id: "Songs", message: "Songs" }), apiKind: "songs" },
  { value: "albums", label: i18n._({ id: "Albums", message: "Albums" }), apiKind: "albums" },
  { value: "artists", label: i18n._({ id: "Bands", message: "Bands" }), apiKind: "artists" },
  { value: "styles", label: i18n._({ id: "Styles", message: "Styles" }) },
  { value: "playlists", label: i18n._({ id: "Playlists", message: "Playlists" }), apiKind: "playlists" },
  { value: "sounds", label: i18n._({ id: "Sounds", message: "Sounds" }) },
];
const SORTS: Array<{ value: LibrarySort; label: string }> = [
  { value: "recents", label: i18n._({ id: "Recently played", message: "Recently played" }) },
  { value: "az", label: i18n._({ id: "Name", message: "Name" }) },
  { value: "creator", label: i18n._({ id: "Creator", message: "Creator" }) },
];
const Icon = ({ name }: { name: string }) => { const Glyph = getIcon(name); return <Glyph aria-hidden="true" />; };

function rowAddress(row: MusicLibraryEntry): { path: string; id?: string } {
  const route = row.route ?? "play";
  const safeRoute = ["play", "album", "artist", "playlist"].includes(route) ? route : "play";
  return { path: `/apps/audio/${safeRoute}`, ...(row.id ? { id: row.id } : {}) };
}

/** The Audio app's compact library column. Its rows and sort come from the package's one canonical Music library endpoint. */
export function MusicLibraryColumn({ pageId }: { pageId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<LibraryKind>("all");
  const [sort, setSort] = useState<LibrarySort>("recents");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [grid, setGrid] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [activeRow, setActiveRow] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeFilter = FILTERS.find((filter) => filter.value === kind);
  const rowsQuery = useQuery({
    queryKey: ["music-sidebar-library", kind, sort],
    queryFn: () => api.appData<MusicLibraryEntry[]>("audio", "songs", { scope: "library", kind: activeFilter?.apiKind ?? "all", sort }),
    staleTime: 2_000,
    retry: false,
  });
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (Array.isArray(rowsQuery.data) ? rowsQuery.data : []).filter((row) => !needle || `${row.title ?? ""} ${row.channel ?? ""} ${row.kind_label ?? ""}`.toLocaleLowerCase().includes(needle));
  }, [rowsQuery.data, query]);

  useEffect(() => {
    if (!searchOpen) return;
    inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const onSlash = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      event.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, []);

  const openRow = (row: MusicLibraryEntry) => {
    const address = rowAddress(row);
    navigate(address.path, { state: address.id ? { pageState: { id: address.id } } : undefined });
  };
  const togglePin = async (row: MusicLibraryEntry) => {
    if (!row.pin_key) return;
    await requestJson("/api/plugins/audio/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "toggle", key: row.pin_key }) });
    await queryClient.invalidateQueries({ queryKey: ["music-sidebar-library"] });
  };

  const listBody = rowsQuery.isPending
    ? <ul className="flex list-none flex-col gap-2 p-2" aria-label={i18n._({ id: "Loading your music library", message: "Loading your music library" })}>{[0, 1, 2, 3, 4].map((index) => <li key={index}><Skeleton shape="row" /></li>)}</ul>
    : rowsQuery.isError
      ? <EmptyState icon="music" text={i18n._({ id: "Your music library could not be loaded. Check your connection and try again.", message: "Your music library could not be loaded. Check your connection and try again." })} actionLabel={i18n._({ id: "Try again", message: "Try again" })} onAction={() => void rowsQuery.refetch()} />
      : rows.length === 0
        ? <EmptyState icon="music" text={query.trim() ? i18n._({ id: "No matches in your library.", message: "No matches in your library." }) : kind === "styles" || kind === "sounds" ? i18n._({ id: "This kind is not available in the Music library yet.", message: "This kind is not available in the Music library yet." }) : i18n._({ id: "Nothing in your library yet.", message: "Nothing in your library yet." })} />
        : <ul ref={listRef} className={grid ? "grid list-none grid-cols-2 gap-1 p-2" : "flex list-none flex-col gap-1 p-2"} aria-label={i18n._({ id: "Music library items", message: "Music library items" })}>
          {rows.map((row, index) => {
            const playing = row.is_song && location.pathname === "/apps/audio/play" && new URLSearchParams(location.search).get("id") === row.id;
            return <li key={row.pin_key ?? row.id ?? `${row.title}-${index}`} className="flex min-w-0 items-center">
              <button type="button" data-library-row="" data-row-index={index} tabIndex={index === activeRow ? 0 : -1} onFocus={() => setActiveRow(index)} onClick={() => openRow(row)} onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const next = Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
                  setActiveRow(next);
                  listRef.current?.querySelectorAll<HTMLButtonElement>("[data-library-row]")[next]?.focus();
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  openRow(row);
                }
              }} className="grid min-h-12 min-w-0 flex-1 grid-cols-6 items-center gap-2 rounded-md p-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                <Cover id={row.id ?? row.title ?? `music-${index}`} title={row.title ?? i18n._({ id: "Untitled", message: "Untitled" })} url={row.thumbnail ?? null} bare />
                <span className="col-span-4 flex min-w-0 flex-col"><span className={playing ? "truncate text-body font-medium text-primary" : "truncate text-body font-medium"}>{row.title ?? i18n._({ id: "Untitled", message: "Untitled" })}</span><span className="truncate text-supporting text-muted-foreground">{i18n._({ id: "{kind} · {owner}", message: "{kind} · {owner}", values: { kind: row.kind_label ?? i18n._({ id: "Song", message: "Song" }), owner: row.channel ?? i18n._({ id: "Unknown", message: "Unknown" }) } })}</span></span>
                {playing ? <span aria-label={i18n._({ id: "Now playing", message: "Now playing" })} className="shrink-0 text-primary"><Icon name="volume-2" /></span> : null}
              </button>
              {row.pin_key ? <Button type="button" variant="ghost" size="icon-sm" aria-label={row.pinned ? i18n._({ id: "Unpin {title}", message: "Unpin {title}", values: { title: row.title ?? "" } }) : i18n._({ id: "Pin {title}", message: "Pin {title}", values: { title: row.title ?? "" } })} aria-pressed={row.pinned} onClick={() => void togglePin(row)}><Icon name={row.pinned ? "pin-off" : "pin"} /></Button> : null}
            </li>;
          })}
        </ul>;

  const searchLabel = i18n._({ id: "Search your library", message: "Search your library" });
  const playlistDisabledReason = i18n._({ id: "Playlists open from a song's menu for now.", message: "Playlists open from a song's menu for now." });
  const densityLabel = grid ? i18n._({ id: "Show as list", message: "Show as list" }) : i18n._({ id: "Show as grid", message: "Show as grid" });
  const actions = <div className="flex items-center gap-0.5">
    <TooltipProvider delayDuration={400}><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={searchLabel} onClick={() => { if (searchOpen) { setQuery(""); setSearchOpen(false); } else setSearchOpen(true); }}><Icon name="search" /></Button></TooltipTrigger><TooltipContent>{searchLabel}</TooltipContent></Tooltip></TooltipProvider>
    <TooltipProvider delayDuration={400}><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" disabled aria-label={playlistDisabledReason} title={playlistDisabledReason}><Icon name="plus" /></Button></TooltipTrigger><TooltipContent>{playlistDisabledReason}</TooltipContent></Tooltip></TooltipProvider>
    <TooltipProvider delayDuration={400}><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={densityLabel} onClick={() => setGrid((value) => !value)}><Icon name={grid ? "list" : "layout-grid"} /></Button></TooltipTrigger><TooltipContent>{densityLabel}</TooltipContent></Tooltip></TooltipProvider>
  </div>;
  const headerTop = <nav aria-label={i18n._({ id: "Music", message: "Music" })}>
    {[{ label: i18n._({ id: "Home", message: "Home" }), path: "/apps/audio", icon: "house", active: pageId === "index" }, { label: i18n._({ id: "Search", message: "Search" }), path: "/apps/audio/search", icon: "search", active: pageId === "search" }].map((item) => <Button key={item.path} type="button" variant="ghost" aria-current={item.active ? "page" : undefined} onClick={() => navigate(item.path)}><Icon name={item.icon} />{item.label}</Button>)}
  </nav>;
  const body = <div className="flex min-h-0 flex-col gap-2">
    <div className="flex flex-wrap gap-1.5 px-2" role="group" aria-label={i18n._({ id: "Filter your music library", message: "Filter your music library" })}>
      {FILTERS.map((filter) => <Chip key={filter.value} selected={kind === filter.value} onClick={() => { setKind(filter.value); setActiveRow(0); }}>{filter.label}</Chip>)}
    </div>
    <div className="px-2">
      <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="secondary" size="sm"><Icon name="chevron-down" />{SORTS.find((item) => item.value === sort)?.label}</Button></DropdownMenuTrigger><DropdownMenuContent align="start">{SORTS.map((item) => <DropdownMenuItem key={item.value} onSelect={() => setSort(item.value)} aria-checked={sort === item.value}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    </div>
    {searchOpen ? <div className="px-2"><Input ref={inputRef} type="search" aria-label={i18n._({ id: "Search in your library", message: "Search in your library" })} placeholder={i18n._({ id: "Search in your library", message: "Search in your library" })} value={query} onChange={(event) => setQuery(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); setSearchOpen(false); } }} /></div> : null}
    <div className="min-h-0 flex-1 overflow-y-auto">{listBody}</div>
  </div>;
  return <SectionSidebar standalone density="compact" headerTop={headerTop} title={i18n._({ id: "Library", message: "Library" })} headerActions={actions} body={body} collapsed={collapsed} onCollapsedChange={setCollapsed} collapsedStyle="hidden" sidebarProps={{ "aria-label": i18n._({ id: "Music library sidebar", message: "Music library sidebar" }) }} />;
}
