// MUSIC-WORKSPACE-01: the Music app's one Create workspace. On a desktop it is three panes: the form (Song, Band, Album or Style, a short or a
// full form), the live list of the songs you made (new ones appear at the top while they are being made) and the song you picked, with its
// player. On a phone it is one pane at a time, switched from the bar on top. Making a song never leaves the page: Create adds the song to the
// list and opens it. A band, an album and a style are made in the same left pane with the kit's own cards (CreatePage), and every one of them
// has its edit card in chat (the edit_* actions), so a change made here or there is one change to one record. Kit parts as shipped, tokens only.
import { useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@maipai/ui/src/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Maker, SongResult, MAKE_SONG_ADULT_LINE } from "./MakeSongPage";
import { CreatePage } from "./MusicStudioPages";
import { requestJson } from "@/lib/api";
import type { MusicCard } from "@/lib/musicApi";

type Make = "song" | "band" | "album" | "song_style";
type Pane = "create" | "songs" | "detail";
const MAKES: Array<{ id: Make; label: string }> = [{ id: "song", label: "Song" }, { id: "band", label: "Band" }, { id: "album", label: "Album" }, { id: "song_style", label: "Style" }];
const PANES: Array<{ id: Pane; label: string }> = [{ id: "create", label: "Create" }, { id: "songs", label: "My songs" }, { id: "detail", label: "Now playing" }];
const active = (card: MusicCard): boolean => card.state === "queued" || card.state === "running";

const clock = (seconds: number | null): string => (seconds && seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : "");

/** What a row says under the title: how far along it is, or its sound. */
export function songLine(card: MusicCard): string {
  if (active(card)) return card.position ? `Waiting, number ${card.position} in line` : `${card.stage_label || "Making your song"}${card.progress > 0 ? ` ${Math.round(card.progress * 100)}%` : ""}`;
  if (card.state === "failed") return card.error_line ?? "This song could not be made. Open it to try again.";
  if (card.state === "cancelled") return "Stopped";
  return card.description ?? "";
}

function SongRow({ card, selected, onOpen }: { card: MusicCard; selected: boolean; onOpen: () => void }) {
  const title = card.title ?? (active(card) ? "Making your song" : "Untitled song");
  const line = songLine(card);
  const length = card.state === "done" ? clock(card.duration_s) : "";
  return <li>
    <button type="button" onClick={onOpen} aria-current={selected ? "true" : undefined} data-testid="music-song-row"
      className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors ${selected ? "bg-muted" : "hover:bg-muted/60"}`}>
      <span className="bg-muted text-muted-foreground relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg text-xl font-semibold">
        {card.cover_url ? <img src={card.cover_url} alt="" className="size-full object-cover" /> : <span aria-hidden="true">{title.slice(0, 1).toUpperCase()}</span>}
        {active(card) ? <span className="bg-background/70 absolute inset-x-0 bottom-0 h-1"><span className="bg-primary block h-full w-(--song-progress)" style={{ "--song-progress": `${Math.max(6, Math.round(card.progress * 100))}%` } as CSSProperties} /></span> : null}
      </span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="text-muted-foreground block truncate text-xs">{line}</span></span>
      {length ? <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{length}</span> : null}
    </button>
  </li>;
}

function SongList({ selected, onOpen, onNone }: { selected: string | null; onOpen: (id: string) => void; onNone: () => void }) {
  const [filter, setFilter] = useState("");
  const list = useQuery({
    queryKey: ["music-songs"], queryFn: () => requestJson<MusicCard[]>("/api/music/jobs"), staleTime: 2_000,
    refetchInterval: (query) => (query.state.data?.some(active) ? 3000 : 20_000),
  });
  const shown = useMemo(() => (list.data ?? []).filter((card) => !filter.trim() || `${card.title ?? ""} ${card.description ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase())), [list.data, filter]);
  return <div className="flex min-h-0 flex-col gap-3" data-testid="music-song-list">
    <Input type="search" aria-label="Search your songs" placeholder="Search your songs" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} />
    {list.isPending ? <p role="status" className="text-muted-foreground text-sm">Loading your songs</p>
      : list.isError ? <p role="alert" className="text-muted-foreground text-sm">Your songs could not be loaded. Check your connection and open this page again.</p>
        : shown.length === 0 ? <EmptyState icon="music" text={filter.trim() ? "No song matches that." : "No songs yet. Describe one on the left and press Create."} />
          : <ul className="flex flex-col gap-1 overflow-y-auto" aria-label="Your songs">{shown.map((card) => <SongRow key={card.id} card={card} selected={card.id === selected} onOpen={() => (card.id === selected ? onNone() : onOpen(card.id))} />)}</ul>}
  </div>;
}

const paneClass = (pane: Pane, shown: Pane): string => `${pane === shown ? "flex" : "hidden"} min-h-0 flex-col gap-4 lg:flex ${pane === "detail" ? "lg:col-span-2" : ""}`;
const workspaceAddress = (song: string | null): string => (song ? `/apps/music/create?song=${encodeURIComponent(song)}` : "/apps/music/create");

/** The Create workspace. `search` is the address's query string: `song` opens a song; `style` and `band` preselect a sound. */
export function MusicWorkspace({ adult, search, start = "song" }: { adult: boolean; search: string; start?: Make }) {
  const navigate = useNavigate();
  const [make, setMake] = useState<Make>(start);
  const [full, setFull] = useState(false);
  const [pane, setPane] = useState<Pane>(new URLSearchParams(search).get("song") ? "detail" : "create");
  const song = new URLSearchParams(search).get("song");
  if (!adult) return <EmptyState icon="music" text={MAKE_SONG_ADULT_LINE} />;
  const open = (id: string | null) => { navigate(workspaceAddress(id), { replace: true }); setPane(id ? "detail" : "create"); };
  return <section className="flex min-h-0 flex-col gap-4 px-4 lg:px-0" data-testid="music-workspace">
    <div className="lg:hidden">
      <ToggleGroup type="single" variant="outline" value={pane} onValueChange={(next) => { if (next) setPane(next as Pane); }} aria-label="Pane">
        {PANES.map((one) => <ToggleGroupItem key={one.id} value={one.id}>{one.label}</ToggleGroupItem>)}
      </ToggleGroup>
    </div>
    <div className="grid min-h-0 gap-6 lg:grid-cols-4">
      <div className={paneClass("create", pane)} data-testid="music-pane-create">
        <h2 className="text-2xl font-semibold tracking-tight">Create</h2>
        <ToggleGroup type="single" variant="outline" value={make} onValueChange={(next) => { if (next) setMake(next as Make); }} aria-label="What to make">
          {MAKES.map((one) => <ToggleGroupItem key={one.id} value={one.id}>{one.label}</ToggleGroupItem>)}
        </ToggleGroup>
        {make === "song" ? <>
          <ToggleGroup type="single" variant="outline" value={full ? "custom" : "simple"} onValueChange={(next) => { if (next) setFull(next === "custom"); }} aria-label="Form">
            <ToggleGroupItem value="simple">Simple</ToggleGroupItem><ToggleGroupItem value="custom">Custom</ToggleGroupItem>
          </ToggleGroup>
          <Maker search={search} simple={!full} onMade={(id) => open(id)} />
        </> : <CreatePage kind={make} adult={adult} />}
      </div>
      <div className={paneClass("songs", pane)} data-testid="music-pane-songs">
        <h2 className="text-2xl font-semibold tracking-tight">My songs</h2>
        <SongList selected={song} onOpen={(id) => open(id)} onNone={() => open(null)} />
      </div>
      <div className={paneClass("detail", pane)} data-testid="music-pane-detail">
        {song ? <div data-testid="music-song-result" className="flex flex-col gap-4"><SongResult key={song} id={song} onAnother={() => { open(null); setMake("song"); }} /></div>
          : <EmptyState icon="music" text="Pick a song from your list to play it, change it or make a new version." />}
      </div>
    </div>
  </section>;
}
