// MUSIC-STUDIO-SONG: the Music app's "Make a song" page. A prompt, optional words, an instrumental switch, an optional saved style and an
// optional made band's sound, then Make. Make runs the same path as the generate_music tool (POST /api/music/songs), the page shows the
// song card the chat shows (the kit's MusicTrack, with Details to change the title, words or style and make a new version that keeps the
// old one), and Keep pins the song in the Library. Kit parts only, restyled by tokens (rule 9). Adults only, like the other studio pages.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MusicTrack } from "@maipai/ui/src/elements/music-track";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { api, request } from "@/lib/api";
import { musicApi, type MakeSongBody, type MusicCard } from "@/lib/musicApi";
import { useMusicTrackProps } from "@/apps/chat/MusicCardView";

export const MAKE_SONG_ADULT_LINE = "Making a song is for adults. Ask a grown-up to make one with you.";
/** Shown when the computer has no music model (or cannot run it): what is wrong and the one next step. */
export const NO_MUSIC_ENGINE_LINE = "Songs cannot be made on this computer yet, because no music model is installed. An admin can add one in Settings, under Pictures, videos and music. Then come back here.";

type Pick = { id: string; name: string; line: string };
type StyleRow = { id: string; title?: string; origin?: string; style?: { description?: string; genres?: string[] } };
type BandRow = { id: string; name?: string; genres?: string[] };

/** The body Make sends: only what the person filled in. Nothing is sent for an empty optional field. */
export function makeSongBody(form: { idea: string; lyrics: string; instrumental: boolean; title: string; length: "quick" | "full" | ""; bpm: string; key: string; styleId: string | null; bandId: string | null }): MakeSongBody {
  const bpm = Number(form.bpm);
  return {
    idea: form.idea.trim(),
    ...(!form.instrumental && form.lyrics.trim() ? { lyrics: form.lyrics } : {}),
    ...(form.instrumental ? { instrumental: true } : {}),
    ...(form.title.trim() ? { title: form.title.trim() } : {}),
    ...(form.length ? { length: form.length } : {}),
    ...(form.bpm.trim() && Number.isFinite(bpm) ? { bpm: Math.round(bpm) } : {}),
    ...(form.key.trim() ? { key: form.key.trim() } : {}),
    ...(form.styleId ? { song_style: form.styleId } : {}),
    ...(form.bandId ? { band: form.bandId } : {}),
  };
}

export const songAddress = (id: string): string => `/apps/music/make-song?song=${encodeURIComponent(id)}`;

const text = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);

export function Field({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-2">
    {id ? <Label htmlFor={id}>{label}</Label> : <p className="text-sm font-semibold">{label}</p>}
    {children}
    {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
  </div>;
}

export function Shelf({ label, hint, picks, value, onChange, empty }: { label: string; hint: string; picks: Pick[]; value: string | null; onChange: (id: string | null) => void; empty?: React.ReactNode }) {
  return <Field label={label} hint={hint}>
    {picks.length === 0 ? <p className="text-muted-foreground text-sm">{empty}</p>
      : <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {picks.map((pick) => <Chip key={pick.id} selected={value === pick.id} onClick={() => onChange(value === pick.id ? null : pick.id)}>{pick.name}</Chip>)}
      </div>}
  </Field>;
}

/** The finished (or still-being-made) song: the kit song card plus Keep and Make another. */
export function SongResult({ id, onAnother }: { id: string; onAnother?: () => void }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [kept, setKept] = useState(false);
  const card = useQuery({
    queryKey: ["music-song", id],
    queryFn: ({ signal }) => musicApi.card(id, signal),
    refetchInterval: (query) => (query.state.data && (query.state.data.state === "queued" || query.state.data.state === "running") ? 2000 : query.state.data ? false : 4000),
    staleTime: 0,
  });
  const placeholder = useMemo<MusicCard>(() => ({ id, task: "text2music", state: "queued", stage: null, stage_label: "Opening your song", stages: [], stage_index: 0, progress: 0, eta_seconds: null, position: null, error_line: null, cover_url: null, cover_versions: [], cover_pending: false, versions: [], current_id: null, length: "full", quality: "quick", boost_offered: false, cut: null, max_seconds: null, title: null, description: null, lyrics: null, timed_lyrics: null, duration_s: null, started_at: 0 }), [id]);
  const shown = card.data ?? placeholder;
  const props = useMusicTrackProps({
    card: shown, owner: true, navigate: (path: string) => navigate(path),
    onRefresh: () => { void card.refetch(); void queryClient.invalidateQueries({ queryKey: ["library"] }); },
    onStop: () => { void musicApi.stop(id).then(() => card.refetch()).catch((error: unknown) => push(text(error, "The song could not be stopped. Try again."))); },
  });
  if (card.isError && !card.data) return <EmptyState icon="music" text="That song is not here any more. It may have been removed from your Library." actionLabel="Make a song" onAction={() => (onAnother ?? (() => navigate("/apps/music/create")))()} />;
  const ready = shown.state === "done" && shown.versions.length > 0;
  const fileId = shown.current_id ?? shown.versions.at(-1)?.id ?? null;
  const keep = () => { if (!fileId) return; api.updateLibraryFile(fileId, { keep: true }).then(() => { setKept(true); push("Kept. This song stays in your Library until you delete it."); }).catch((error: unknown) => push(text(error, "The song could not be kept. Try again."))); };
  return <>
    <MusicTrack {...props} />
    {ready ? <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant={kept ? "secondary" : "default"} disabled={kept} onClick={keep}>{kept ? "Kept in your Library" : "Keep in my Library"}</Button>
      <Button asChild variant="outline"><Link to={`/apps/music/studio?song=${encodeURIComponent(id)}`}>Open in Studio</Link></Button>
      {fileId ? <Button asChild variant="outline"><Link to={`/files?file=${encodeURIComponent(fileId)}`}>Open in Library</Link></Button> : null}
      <Button type="button" variant="ghost" onClick={onAnother ?? (() => navigate("/apps/music/create"))}>Make another</Button>
    </div> : null}
    {ready ? <p className="text-muted-foreground text-sm">Every song you make lands in your Library. Keep pins it so storage clean-up never removes it. Open Edit above to change the title, words or style; your earlier version stays.</p> : null}
    {shown.state === "failed" || shown.state === "cancelled" ? <Button type="button" variant="outline" onClick={onAnother ?? (() => navigate("/apps/music/create"))}>Start over</Button> : null}
  </>;
}

/** The song form. `simple` is the Suno-style short form (the idea and Create); the full form adds words, a title, tempo and the saved sounds. */
export function Maker({ search, simple = false, onMade }: { search: string; simple?: boolean; onMade?: (id: string) => void }) {
  const navigate = useNavigate();
  const { push } = useToast();
  const prefill = useMemo(() => new URLSearchParams(search), [search]);
  const status = useQuery({ queryKey: ["music-status"], queryFn: () => musicApi.status(), staleTime: 10_000, retry: false });
  const styles = useQuery({ queryKey: ["music-made", "song_style"], queryFn: () => request<StyleRow[]>("/api/music/styles?scope=all"), staleTime: 15_000 });
  const bands = useQuery({ queryKey: ["music-made", "band"], queryFn: () => request<BandRow[]>("/api/music/bands"), staleTime: 15_000 });
  const [idea, setIdea] = useState(""); const [lyrics, setLyrics] = useState(""); const [title, setTitle] = useState("");
  const [instrumental, setInstrumental] = useState(false); const [length, setLength] = useState<"quick" | "full" | "">("");
  const [bpm, setBpm] = useState(""); const [key, setKey] = useState("");
  const [styleId, setStyleId] = useState<string | null>(prefill.get("style")); const [bandId, setBandId] = useState<string | null>(prefill.get("band"));
  const [tags, setTags] = useState<string[]>([]); const [tag, setTag] = useState(""); const [making, setMaking] = useState(false); const [problem, setProblem] = useState("");
  useEffect(() => { setStyleId(prefill.get("style")); setBandId(prefill.get("band")); }, [prefill]);

  const stylePicks: Pick[] = (styles.data ?? []).map((row) => ({ id: row.id, name: row.title ?? "Untitled style", line: row.style?.description ?? "" }));
  const bandPicks: Pick[] = (bands.data ?? []).map((row) => ({ id: row.id, name: row.name ?? "Untitled band", line: "" }));
  const engineMissing = status.data ? !status.data.can_make : false;
  const blocked = status.isError ? (status.error instanceof Error ? status.error.message : "") : "";
  const ready = idea.trim().length >= 3 && !making && !engineMissing && !status.isPending;
  const limits = status.data?.limits ?? null;

  const make = () => {
    if (!ready) return;
    setMaking(true); setProblem("");
    musicApi.makeSong(makeSongBody({ idea: tags.length ? `${idea.trim()} Style: ${tags.join(", ")}.` : idea, lyrics, instrumental, title, length, bpm, key, styleId, bandId }))
      .then((card) => { if (onMade) { setIdea(""); setTags([]); onMade(card.id); } else navigate(songAddress(card.id)); })
      .catch((error: unknown) => { const line = text(error, "Home could not start the song. Check the request and try again."); setProblem(line); push(line); })
      .finally(() => setMaking(false));
  };

  const addTag = () => { const next = tag.trim().replace(/,$/, "").slice(0, 40); if (next && !tags.includes(next) && tags.length < 8) setTags([...tags, next]); setTag(""); };
  return <div className={`flex flex-col gap-5 ${onMade ? "" : "px-4 lg:px-0"}`} data-testid="music-make-song-form">
    {engineMissing ? <Alert role="alert" data-testid="music-no-engine"><AlertDescription>{NO_MUSIC_ENGINE_LINE}</AlertDescription></Alert> : null}
    {blocked ? <Alert role="alert" variant="destructive"><AlertDescription>{blocked}</AlertDescription></Alert> : null}
    <Field id="song-idea" label="Describe your song" hint={`${idea.length} / 1200`}>
      <Textarea id="song-idea" rows={simple ? 5 : 3} maxLength={1200} value={idea} onChange={(event) => setIdea(event.currentTarget.value)} placeholder="A dreamy indie pop song about new beginnings, with warm guitar and an upbeat tempo" />
    </Field>
    <Field label="Styles" hint="Type a style and press Enter. Words only, never lyrics.">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Styles">
        {tags.map((name) => <Chip key={name} selected onClick={() => setTags(tags.filter((one) => one !== name))} aria-label={`Remove ${name}`}>{name} ×</Chip>)}
      </div>
      <Input id="song-tag" aria-label="Add a style" maxLength={40} value={tag} onChange={(event) => setTag(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addTag(); } }} onBlur={addTag} placeholder="slow ballad, ethereal synths" />
    </Field>
    <div className="flex items-center justify-between gap-4 rounded-2xl border p-4">
      <div className="flex min-w-0 flex-col"><Label htmlFor="song-instrumental">Instrumental</Label><p className="text-muted-foreground text-xs">No singing, just the music.</p></div>
      <Switch id="song-instrumental" checked={instrumental} onCheckedChange={setInstrumental} />
    </div>
    {simple ? null : <>
      {instrumental ? null : <Field id="song-lyrics" label="Lyrics (optional)" hint="Write your own words with [Verse] and [Chorus] tags, or leave this empty and Home writes the words.">
        <Textarea id="song-lyrics" rows={6} maxLength={4000} value={lyrics} onChange={(event) => setLyrics(event.currentTarget.value)} />
      </Field>}
      <Shelf label="Song style (optional)" hint="A saved sound to start from. Pick it again to clear it." picks={stylePicks} value={styleId} onChange={setStyleId}
        empty={styles.isPending ? "Loading styles" : styles.isError ? "Styles could not be loaded. Open this page again." : <>No styles yet. <Link className="text-foreground underline underline-offset-4" to="/apps/music/make-style">Make a song style</Link></>} />
      <Shelf label="In a band's sound (optional)" hint="Makes the song sound like one of the bands you made." picks={bandPicks} value={bandId} onChange={setBandId}
        empty={bands.isPending ? "Loading bands" : bands.isError ? "Bands could not be loaded. Open this page again." : <>No bands yet. <Link className="text-foreground underline underline-offset-4" to="/apps/music/make-band">Make a band</Link></>} />
      <Field id="song-title" label="Title (optional)"><Input id="song-title" maxLength={200} value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="Home picks one if you leave this empty" /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Length" hint={limits ? `Up to ${Math.floor(limits.max_seconds / 60)} minutes on this computer.` : undefined}>
          <ToggleGroup type="single" variant="outline" value={length} onValueChange={(next) => setLength(next === "quick" || next === "full" ? next : "")} aria-label="Length">
            <ToggleGroupItem value="quick">Quick</ToggleGroupItem><ToggleGroupItem value="full">Full</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field id="song-bpm" label="Tempo (BPM)"><Input id="song-bpm" inputMode="numeric" type="number" min={20} max={300} value={bpm} onChange={(event) => setBpm(event.currentTarget.value)} placeholder="Auto" /></Field>
        <Field id="song-key" label="Key"><Input id="song-key" maxLength={20} value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder="Auto, for example C major" /></Field>
      </div>
    </>}
    {problem ? <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert> : null}
    <div className="flex flex-col gap-2">
      <Button type="button" size="lg" disabled={!ready} onClick={make}>{making ? "Starting your song" : "Create song"}</Button>
      <p className="text-muted-foreground text-sm">{idea.trim().length < 3 ? "Say what the song is about to start." : "It takes about a minute. It shows up in your list."}</p>
    </div>
  </div>;
}

/** The Make a song page. `search` is the address's query string: `song` opens a made song; `style` and `band` preselect a sound. */
export function MakeSongPage({ adult, search }: { adult: boolean; search: string }) {
  if (!adult) return <EmptyState icon="music" text={MAKE_SONG_ADULT_LINE} />;
  const song = new URLSearchParams(search).get("song");
  return <section className="flex flex-col gap-5" data-testid="music-make-song">
    <header className="flex flex-col gap-1 px-4 lg:px-0">
      <h2 className="text-3xl font-semibold tracking-tight">Make a song</h2>
      <p className="text-muted-foreground max-w-xl text-sm">{song ? "Your song. Press play, or open Edit to change it." : "Tell Home what you want to hear. Add your own words, a saved style or a band's sound if you like."}</p>
    </header>
    {song ? <div className="flex max-w-2xl flex-col gap-4 px-4 lg:px-0" data-testid="music-song-result"><SongResult key={song} id={song} /></div> : null}
    {song ? null : <div className="max-w-2xl"><Maker search={search} /></div>}
  </section>;
}
