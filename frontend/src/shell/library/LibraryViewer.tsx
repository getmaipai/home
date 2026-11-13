import { i18n } from "@lingui/core";
// The full-screen viewer over the current list: previous and next, zoom, the player for video and songs, an info panel
// and the person's actions. The page owns the address (`?file=<id>`), so Back closes it and a link opens it after the hub's
// access check.
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { CreationHeader } from "@maipai/ui/src/elements/creation-header";
import { MediaViewer, type MediaViewerItem } from "@maipai/ui/src/elements/media-viewer";
import { MusicTrack } from "@maipai/ui/src/elements/music-track";
import { SharePanel } from "@maipai/ui/src/elements/share-panel";
import { Button } from "@maipai/ui/src/ui/button";
import { formatBytes } from "@maipai/ui/src/format";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type LibraryItem, type Roster } from "@/lib/api";
import { musicApi, type MusicCard } from "@/lib/musicApi";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { useCutToBeatDialog } from "./CutToBeatDialog";
import { NEW_MUSIC, useAddMusicDialog, type MusicLevel } from "./AddMusicDialog";
import { Input as KitInput } from "@maipai/ui/src/ui/input";
import { Checkbox as KitCheckbox } from "@maipai/ui/src/ui/checkbox";
import { Label as KitLabel } from "@maipai/ui/src/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { useMusicTrackProps } from "@/apps/chat/MusicCardView";
import { prepareClip, saveClip, shareClip } from "@/lib/shareClip";
import { canShareFiles, creationOf, fileKind, isAdultRole, kindWord } from "./libraryModel";
import { libraryOrigin } from "./libraryOrigin";
import type { ItemActions } from "./LibraryItems";
import { useAdultMark } from "@/apps/chat/useAdultMark";
import { useTranscriptWorkspace } from "./TranscriptPanel";
import { seekViewerMedia, useViewerMediaTime } from "./viewerMedia";
import { formatDate } from "@/lib/format";
import { errorLine } from "@/lib/hubReachability";

const ShareIcon = getIcon("users");
const CaptionsIcon = getIcon("captions");
const SendIcon = getIcon("arrow-up-right");
const DownloadIcon = getIcon("download");
const TrashIcon = getIcon("trash");
const SEND_PREPARE_MAX_BYTES = 64 * 1024 * 1024;
const date = (iso: string) => formatDate(iso, { year: "numeric", month: "short", day: "numeric" });

export function viewerItemOf(item: LibraryItem): MediaViewerItem {
  const kind = fileKind(item.kind);
  return {
    id: item.id, kind, name: item.name, mediaType: item.media_type,
    url: api.fileContentUrl(item.id),
    posterUrl: kind === "video" || kind === "audio" ? item.thumb_url.replace("w=320", "w=640") : null,
  };
}

function Details({ item, me, actions }: { item: LibraryItem; me: Roster; actions: ItemActions }) {
  const mine = item.owner.id === me.id;
  const record = useQuery({ queryKey: ["library-file", item.id], queryFn: () => api.libraryFile(item.id) });
  const shares = useQuery({ queryKey: ["file-shares", item.id], queryFn: () => api.fileShares(item.id), enabled: mine && item.shared_with.count > 0 });
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.people(), enabled: true });
  const sharedWith = (shares.data ?? []).filter((share) => share.to !== "household").map((share) => ({ id: share.to, name: people.data?.find((person) => person.id === share.to)?.display_name ?? "Someone in your home" }));
  const seeds: Record<string, string> = Object.fromEntries((people.data ?? []).map((person) => [person.id, person.avatar_seed]));
  seeds[me.id] ??= me.avatar_seed;
  const creation = creationOf(item, me, sharedWith, seeds);
  const [panelOpen, setPanelOpen] = useState(false);
  const navigate = useNavigate();
  const [splitting, setSplitting] = useState(false);
  const [stemsProblem, setStemsProblem] = useState("");
  const [cutOpen, setCutOpen] = useState(false);
  const cut = useCutToBeatDialog({ open: cutOpen, onOpenChange: setCutOpen, me, seed: item.kind === "audio" ? { trackId: item.id } : { clipId: item.id } });
  const [musicOpen, setMusicOpen] = useState(false);
  const addMusic = useAddMusicDialog({ open: musicOpen, onOpenChange: setMusicOpen, me, clipId: item.id });
  const kept = item.retention === "kept";
  const row = (label: string, value: ReactNode) => <div><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>;
  const origin = libraryOrigin(item, record.data?.origin);
  const song = record.data?.music;
  const songCard: MusicCard = song ? {
    id: song.id, task: "text2music", state: "done", stage: "ready", stage_label: "", stages: [{ id: "queued", label: "Queued" }, { id: "model", label: "Loading" }, { id: "planning", label: "Planning" }, { id: "making", label: "Making" }, { id: "mixing", label: "Mixing" }, { id: "finishing", label: "Finishing" }], stage_index: 5, progress: 1, eta_seconds: null, position: null, error_line: null,
    cover_url: song.cover_url, cover_versions: [], cover_pending: false, versions: song.versions, current_id: song.current_id,
    length: "full", quality: "quick", boost_offered: false, cut: null, max_seconds: null, title: song.title, description: song.description, lyrics: song.lyrics,
    timed_lyrics: song.timed_lyrics, duration_s: item.duration_seconds, started_at: Date.parse(item.created_at),
  } : { id: "", task: "text2music", state: "queued", stage: null, stage_label: "", stages: [{ id: "queued", label: "Queued" }, { id: "model", label: "Loading" }, { id: "planning", label: "Planning" }, { id: "making", label: "Making" }, { id: "mixing", label: "Mixing" }, { id: "finishing", label: "Finishing" }], stage_index: 0, progress: 0, eta_seconds: null, position: null, error_line: null, cover_url: null, cover_versions: [], cover_pending: false, versions: [], current_id: null, length: "full", quality: "quick", boost_offered: false, cut: null, max_seconds: null, title: null, description: null, lyrics: null, timed_lyrics: null, duration_s: null, started_at: 0 };
  const songTrackProps = useMusicTrackProps({ card: songCard, owner: song?.owner ?? false, onRefresh: () => { void record.refetch(); } });
  const adultMark = useAdultMark({ confirmUnmark: api.confirmLibraryUnmark, adultMark: api.libraryAdultMark }, mine ? item : null, () => { void record.refetch(); }, (action) => <Button key={action.id} type="button" variant="secondary" disabled={action.disabled} onClick={action.onSelect}>{action.label}</Button>);
  return (
    <>
      {song ? <MusicTrack {...songTrackProps} /> : null}
      <CreationHeader title={creation.title} creator={{ ...creation.creator }} madeAt={creation.madeAt} headingLevel="h2" visibility={{ mode: creation.mode, people: creation.people, canManage: creation.canManage, onOpen: () => { if (creation.canManage) actions.share(item); else setPanelOpen(true); } }} />
      <SharePanel open={panelOpen} onOpenChange={setPanelOpen} people={creation.people} candidates={[]} canManage={false} onAdd={() => {}} onRemove={() => {}} onMakePrivate={() => {}} />
      <div className="flex flex-col gap-4">
      <dl className="grid gap-3 pt-4 text-base">
        {row("Type", `${kindWord(item.kind)}, ${item.media_type}`)}
        {row("Size", formatBytes(item.size_bytes))}
        {row("Origin", origin.href ? <Link className="text-primary underline-offset-4 hover:underline" to={origin.href}>{origin.label}</Link> : origin.label)}
        {row("Keeping", kept ? "Kept until you delete it." : item.expires_at ? `Home plans to remove this on ${date(item.expires_at)} to make room. Keep it to stop that.` : "Follows your storage rules. Keep it to stop automatic removal.")}
        {item.version_count > 1 ? row("Versions", `${item.version_count} versions. The newest one shows.`) : null}
        {item.audience === "adult-only" ? row("Audience", "Adults only. Teens and children never see this picture.") : null}
      </dl>
      {mine ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => actions.rename(item)}>{i18n._({ id: "Rename", message: "Rename" })}</Button>
          {item.kind === "image" ? <Button type="button" variant="secondary" onClick={() => navigate("/apps/image/studio", { state: { pageState: { file: item.id } } })}>{i18n._({ id: "Edit", message: "Edit" })}</Button> : null}
          {item.kind === "image" ? <Button type="button" variant="secondary" onClick={() => navigate("/apps/video/create", { state: { pageState: { start_frame: item.id } } })}>{i18n._({ id: "Make a video from this", message: "Make a video from this" })}</Button> : null}
          {!kept ? <Button type="button" variant="secondary" onClick={() => actions.keep(item)}>{i18n._({ id: "Keep", message: "Keep" })}</Button> : null}
          {adultMark.actions}
          {isAdultRole(me) && item.kind === "audio" && !record.data?.music ? <Button type="button" variant="secondary" disabled={splitting} onClick={() => { setSplitting(true); setStemsProblem(""); void musicApi.stemsFromFile(item.id).then((card) => { if (card.conversation_id) navigate(`/chat?conversation=${encodeURIComponent(card.conversation_id)}`); }).catch((error: unknown) => setStemsProblem(errorLine(error, i18n._({ id: "The stems could not be made. Try again in a minute.", message: "The stems could not be made. Try again in a minute." })))).finally(() => setSplitting(false)); }}>{i18n._({ id: "Split into stems", message: "Split into stems" })}</Button> : null}
          {isAdultRole(me) && (item.kind === "audio" || item.kind === "video") ? <Button type="button" variant="secondary" onClick={() => setCutOpen(true)}>{i18n._({ id: "Cut to the beat", message: "Cut to the beat" })}</Button> : null}
          {isAdultRole(me) && item.kind === "video" && item.origin === "made" && item.chat_id ? <Button type="button" variant="secondary" onClick={() => setMusicOpen(true)}>{i18n._({ id: "Add music", message: "Add music" })}</Button> : null}
          {isAdultRole(me) && item.kind === "image" && item.audience === "adult-only" ? <Button type="button" variant="secondary" onClick={() => actions.recheck(item)}>{i18n._({ id: "Mark all-ages", message: "Mark all-ages" })}</Button> : null}
        </div>
      ) : null}
      {adultMark.dialog}
      {stemsProblem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={stemsProblem} /> : null}
      {mine && isAdultRole(me) && item.kind === "audio" ? <p className="text-sm text-muted-foreground">{i18n._({ id: "Cuts your videos on the beat of this song. Everything stays on this home server.", message: "Cuts your videos on the beat of this song. Everything stays on this home server." })}</p> : null}
      <Dialog open={musicOpen} onOpenChange={setMusicOpen}><DialogContent><DialogHeader><DialogTitle>{i18n._({ id: "Add music", message: "Add music" })}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-2"><KitLabel htmlFor="music-choice">{i18n._({ id: "Music", message: "Music" })}</KitLabel><Select value={addMusic.choice} onValueChange={(value) => addMusic.setChoice(value ?? NEW_MUSIC)}><SelectTrigger id="music-choice"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NEW_MUSIC}>{i18n._({ id: "Make new music for this video", message: "Make new music for this video" })}</SelectItem>{addMusic.songs.map((song) => <SelectItem key={song.id} value={song.id}>{song.name}</SelectItem>)}</SelectContent></Select></div>
        {addMusic.choice === NEW_MUSIC ? <div className="flex flex-col gap-2"><KitLabel htmlFor="music-description">{i18n._({ id: "What should it sound like?", message: "What should it sound like?" })}</KitLabel><KitInput id="music-description" value={addMusic.description} placeholder={i18n._({ id: "Soft piano, slow and warm", message: "Soft piano, slow and warm" })} maxLength={600} onChange={(event) => addMusic.setDescription(event.target.value)} /><p className="text-sm text-muted-foreground">{i18n._({ id: "Home makes music about as long as the video, then puts it under the video as a new version. Your first video is kept.", message: "Home makes music about as long as the video, then puts it under the video as a new version. Your first video is kept." })}</p></div> : null}
        <div className="flex flex-col gap-2"><KitLabel htmlFor="music-level">{i18n._({ id: "How loud", message: "How loud" })}</KitLabel><Select value={addMusic.level} onValueChange={(value) => addMusic.setLevel((value ?? "soft") as MusicLevel)}><SelectTrigger id="music-level"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="quiet">{i18n._({ id: "Quiet", message: "Quiet" })}</SelectItem><SelectItem value="soft">{i18n._({ id: "Soft", message: "Soft" })}</SelectItem><SelectItem value="balanced">{i18n._({ id: "Balanced", message: "Balanced" })}</SelectItem><SelectItem value="loud">{i18n._({ id: "Loud", message: "Loud" })}</SelectItem></SelectContent></Select></div>
        {addMusic.problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={addMusic.problem} /> : null}
        <DialogFooter><Button type="button" disabled={addMusic.busy || !addMusic.ready} onClick={() => void addMusic.submit()}>{i18n._({ id: "Add the music", message: "Add the music" })}</Button></DialogFooter>
      </DialogContent></Dialog>
      <Dialog open={cutOpen} onOpenChange={setCutOpen}><DialogContent><DialogHeader><DialogTitle>{i18n._({ id: "Cut to the beat", message: "Cut to the beat" })}</DialogTitle></DialogHeader>
        {cut.seededSong ? <div className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">{cut.clips.length === 0 ? i18n._({ id: "You have no finished videos to cut yet. Make a video in chat first, then come back.", message: "You have no finished videos to cut yet. Make a video in chat first, then come back." }) : i18n._({ id: "Choose up to six videos, in the order you pick them.", message: "Choose up to six videos, in the order you pick them." })}</p>{cut.clips.map((clip) => { const index = cut.picked.indexOf(clip.id); const id = `cut-video-${clip.id}`; return <div key={clip.id} className="flex items-center gap-2"><KitCheckbox id={id} checked={index >= 0} disabled={index < 0 && cut.picked.length >= 6} onCheckedChange={(value) => cut.toggle(clip.id, value === true)} /><KitLabel htmlFor={id}>{index >= 0 ? `${index + 1}. ` : ""}{clip.name}</KitLabel></div>; })}</div> : <div className="flex flex-col gap-2"><KitLabel htmlFor="cut-song">{i18n._({ id: "Song", message: "Song" })}</KitLabel><Select value={cut.track} onValueChange={(value) => cut.setTrack(value ?? "")}><SelectTrigger id="cut-song"><SelectValue placeholder={i18n._({ id: "Choose a song", message: "Choose a song" })} /></SelectTrigger><SelectContent>{cut.tracks.map((track) => <SelectItem key={track.id} value={track.id}>{track.name}</SelectItem>)}</SelectContent></Select></div>}
        <div className="flex flex-col gap-2"><KitLabel htmlFor="cut-beats">{i18n._({ id: "Cut every", message: "Cut every" })}</KitLabel><Select value={cut.beats} onValueChange={(value) => cut.setBeats(value ?? "4")}><SelectTrigger id="cut-beats"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">{i18n._({ id: "1 beat", message: "1 beat" })}</SelectItem><SelectItem value="2">{i18n._({ id: "2 beats", message: "2 beats" })}</SelectItem><SelectItem value="4">{i18n._({ id: "4 beats (one bar)", message: "4 beats (one bar)" })}</SelectItem><SelectItem value="8">{i18n._({ id: "8 beats", message: "8 beats" })}</SelectItem></SelectContent></Select></div>
        <div className="flex flex-col gap-2"><KitLabel htmlFor="cut-length">{i18n._({ id: "Length", message: "Length" })}</KitLabel><Select value={cut.length} onValueChange={(value) => cut.setLength(value ?? "30")}><SelectTrigger id="cut-length"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="15">{i18n._({ id: "15 seconds", message: "15 seconds" })}</SelectItem><SelectItem value="30">{i18n._({ id: "30 seconds", message: "30 seconds" })}</SelectItem><SelectItem value="60">{i18n._({ id: "60 seconds", message: "60 seconds" })}</SelectItem></SelectContent></Select></div>
        {cut.problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={cut.problem} /> : null}
        <DialogFooter><Button type="button" disabled={cut.busy || cut.picked.length === 0 || !cut.track} onClick={() => void cut.submit()}>{i18n._({ id: "Make the cut", message: "Make the cut" })}</Button></DialogFooter>
      </DialogContent></Dialog>
      {item.can_edit && item.chat_id ? <Button asChild variant="secondary"><Link to={`/chat?conversation=${encodeURIComponent(item.chat_id)}`}>{i18n._({ id: "Edit in its chat", message: "Edit in its chat" })}</Link></Button> : mine && item.kind === "image" && !item.chat_id && record.data?.origin === "made" ? <p className="text-muted-foreground text-base">{i18n._({ id: "Its chat was deleted, so it cannot be edited here.", message: "Its chat was deleted, so it cannot be edited here." })}</p> : null}
      </div>
    </>
  );
}

export function LibraryViewer({ items, me, currentId, onCurrentIdChange, onClose, actions, phone }: { phone: boolean; items: readonly LibraryItem[]; me: Roster; currentId: string | null; onCurrentIdChange: (id: string) => void; onClose: () => void; actions: ItemActions }) {
  // undefined leaves the viewer on its own default (open on a wide screen) until the person opens or closes the panel.
  const [transcriptOpen, setTranscriptOpen] = useState<boolean | undefined>(undefined);
  const viewerItems = useMemo(() => items.map(viewerItemOf), [items]);
  const open = currentId !== null && items.some((item) => item.id === currentId);
  const current = items.find((item) => item.id === currentId);
  const sendable = current !== undefined && canShareFiles(me) && current.size_bytes <= SEND_PREPARE_MAX_BYTES;
  const prepared = useQuery({
    queryKey: ["library-prepared", current?.id],
    queryFn: ({ signal }) => prepareClip(api.fileContentUrl(current!.id), signal, { type: current!.media_type, name: current!.name }),
    enabled: open && sendable, staleTime: Infinity, gcTime: 60_000, retry: false,
  });
  const mediaTime = useViewerMediaTime(open);
  const transcriptNode = useTranscriptWorkspace({ item: current, me, currentTime: mediaTime, onSeek: seekViewerMedia });
  if (!open || !current) return null;
  const supportsTranscript = (current.kind === "audio" || current.kind === "video") && (me.age_band === "teen" || isAdultRole(me));
  return (
    <>
    <MediaViewer
      open
      onOpenChange={() => {}}
      onClose={onClose}
      items={viewerItems}
      currentId={currentId}
      onCurrentIdChange={onCurrentIdChange}
      detailsOpen={transcriptOpen}
      onDetailsOpenChange={setTranscriptOpen}
      details={(viewing) => { const item = items.find((entry) => entry.id === viewing.id); return item ? <>{supportsTranscript && viewing.id === current.id ? transcriptNode : null}<Details item={item} me={me} actions={actions} /></> : null; }}
      toolbar={(viewing) => {
        const item = items.find((entry) => entry.id === viewing.id);
        if (!item) return null;
        const mine = item.owner.id === me.id;
        return (
          <>
            {supportsTranscript ? <Button type="button" variant="secondary" size={phone ? "icon" : "default"} aria-label={i18n._({ id: "Transcript", message: "Transcript" })} onClick={() => setTranscriptOpen(true)}>{phone ? <CaptionsIcon aria-hidden="true" /> : i18n._({ id: "Transcript", message: "Transcript" })}</Button> : null}
            {mine && canShareFiles(me) ? <Button type="button" variant="secondary" size={phone ? "icon" : "default"} aria-label={i18n._({ id: "Share", message: "Share" })} onClick={() => actions.share(item)}>{phone ? <ShareIcon aria-hidden /> : i18n._({ id: "Share", message: "Share" })}</Button> : null}
            {canShareFiles(me) ? <Button type="button" variant="secondary" size={phone ? "icon" : "default"} aria-label={i18n._({ id: "Send", message: "Send" })} onClick={() => { void shareClip({ prepared: prepared.data, title: item.name, nav: navigator, fallback: () => saveClip({ url: api.fileContentUrl(item.id), name: item.name, ...(prepared.data ? { blob: prepared.data.blob } : {}) }) }); }}>{phone ? <SendIcon aria-hidden /> : i18n._({ id: "Send", message: "Send" })}</Button> : null}
            <Button asChild variant="secondary" size={phone ? "icon" : "default"}><a href={api.fileContentUrl(item.id)} download={item.name} aria-label={i18n._({ id: "Download", message: "Download" })}>{phone ? <DownloadIcon aria-hidden /> : i18n._({ id: "Download", message: "Download" })}</a></Button>
            {mine ? <Button type="button" variant="destructive" size={phone ? "icon" : "default"} aria-label={i18n._({ id: "Delete", message: "Delete" })} onClick={() => actions.trash(item)}>{phone ? <TrashIcon aria-hidden /> : i18n._({ id: "Delete", message: "Delete" })}</Button> : null}
          </>
        );
      }}
      returnFocusTo={() => Array.from(document.querySelectorAll<HTMLElement>("[data-file-id]")).find((cell) => cell.dataset.fileId === currentId)?.querySelector<HTMLElement>('[data-slot="file-tile-main"]')}
    />
    </>
  );
}
