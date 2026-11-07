// SOUNDS-FOLLOW-01: the takes of one sound request (keep the best, delete the others) and "Add to a song". Kit parts only; no layout classes on kit Elements.
import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { MediaCarousel, MediaTile } from "@maipai/ui/src/ui/media-tiles";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { musicApi, type MusicCard } from "@/lib/musicApi";

const errorLine = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);
const play = (src: string, loop: boolean) => { const audio = new Audio(src); audio.loop = loop; void audio.play(); };

/** The takes one request made, side by side. "Keep this one" saves it to Sounds and deletes the others. */
export function SoundTakes({ group, onChanged }: { group: string; onChanged: () => void }) {
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const takes = useQuery({ queryKey: ["music-sound-takes", group], queryFn: () => musicApi.soundTakes(group), staleTime: 0, refetchInterval: query => query.state.data?.some(take => take.state === "queued" || take.state === "running") ? 2000 : false });
  if (!takes.data || takes.data.length < 2) return null;
  const refresh = () => { void takes.refetch(); void queryClient.invalidateQueries({ queryKey: ["music-sounds"] }); onChanged(); };
  const keep = (jobId: string) => {
    setBusy(true);
    void musicApi.saveSound(jobId)
      .then(() => Promise.all(takes.data!.filter(take => take.job_id !== jobId).map(take => musicApi.remove(take.job_id))))
      .then(() => { push(i18n._({ id: "Kept that take and deleted the others.", message: "Kept that take and deleted the others." })); })
      .catch((error: unknown) => push(errorLine(error, i18n._({ id: "Home could not keep that take. Try again.", message: "Home could not keep that take. Try again." }))))
      .finally(() => { setBusy(false); refresh(); });
  };
  const remove = (jobId: string) => {
    setBusy(true);
    void musicApi.remove(jobId)
      .catch((error: unknown) => push(errorLine(error, i18n._({ id: "Home could not delete that take. Try again.", message: "Home could not delete that take. Try again." }))))
      .finally(() => { setBusy(false); refresh(); });
  };
  return <div data-testid="sound-takes"><MediaCarousel title={i18n._({ id: "Your takes", message: "Your takes" })} line={i18n._({ id: "Listen to each one, keep the best and delete the rest.", message: "Listen to each one, keep the best and delete the rest." })} label={i18n._({ id: "Your takes", message: "Your takes" })}>
    {takes.data.map(take => <MediaTile key={take.job_id} id={take.job_id} busy={take.state === "queued" || take.state === "running"}
      title={i18n._({ id: "Take {n}", message: "Take {n}", values: { n: take.index + 1 } })}
      line={take.state === "failed" ? i18n._({ id: "Could not be made", message: "Could not be made" }) : take.state === "cancelled" ? i18n._({ id: "Stopped", message: "Stopped" }) : take.state !== "done" ? i18n._({ id: "Making the sound", message: "Making the sound" }) : take.saved ? i18n._({ id: "Saved in Sounds", message: "Saved in Sounds" }) : `${take.seconds ?? ""}s`}
      coverUrl={null} playable={take.state === "done" && !!take.src} onOpen={() => { if (take.src) play(take.src, take.loop); }}>
      {take.state === "done" ? <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => keep(take.job_id)}>{i18n._({ id: "Keep this one", message: "Keep this one" })}</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => remove(take.job_id)}>{i18n._({ id: "Delete", message: "Delete" })}</Button>
      </div> : null}
    </MediaTile>)}
  </MediaCarousel></div>;
}

/** A dialog that lays a made sound into one of the person's songs at a start time, as a new version. The song and the sound stay. */
export function AddSoundToSong({ jobId, open, onOpenChange, songs, onAdded }: { jobId: string | null; open: boolean; onOpenChange: (open: boolean) => void; songs: MusicCard[]; onAdded: (songId: string) => void }) {
  const { push } = useToast();
  const [songId, setSongId] = useState("");
  const [start, setStart] = useState("0");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  const startS = Number(start);
  const valid = !!jobId && !!songId && start.trim() !== "" && Number.isFinite(startS) && startS >= 0 && startS <= 3600;
  const choices = songs.filter(card => card.state === "done" && !card.sound);
  const add = () => {
    if (!valid || working) return;
    setWorking(true); setProblem("");
    void musicApi.addSoundToSong(jobId!, { song_id: songId, start_s: startS })
      .then(() => { push(i18n._({ id: "Added. The song has a new version with the sound in it. The first version is still there.", message: "Added. The song has a new version with the sound in it. The first version is still there." })); onOpenChange(false); onAdded(songId); })
      .catch((error: unknown) => setProblem(errorLine(error, i18n._({ id: "Home could not add the sound to that song. Try again.", message: "Home could not add the sound to that song. Try again." }))))
      .finally(() => setWorking(false));
  };
  return <div data-testid="add-sound-to-song-host"><Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-testid="add-sound-to-song">
    <DialogHeader><DialogTitle>{i18n._({ id: "Add to a song", message: "Add to a song" })}</DialogTitle>
      <DialogDescription>{i18n._({ id: "Pick a song and the second where the sound starts. Home makes a new version of the song and keeps the first one.", message: "Pick a song and the second where the sound starts. Home makes a new version of the song and keeps the first one." })}</DialogDescription></DialogHeader>
    {choices.length === 0 ? <p className="text-muted-foreground text-sm">{i18n._({ id: "You have no finished songs yet. Make a song first, then add the sound to it.", message: "You have no finished songs yet. Make a song first, then add the sound to it." })}</p> : <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2"><Label>{i18n._({ id: "Song", message: "Song" })}</Label>
        <Select value={songId} onValueChange={value => setSongId(value ?? "")}>
          <SelectTrigger aria-label={i18n._({ id: "Song", message: "Song" })}><SelectValue placeholder={i18n._({ id: "Choose a song", message: "Choose a song" })} /></SelectTrigger>
          <SelectContent>{choices.map(card => <SelectItem key={card.id} value={card.id}>{card.title ?? i18n._({ id: "Untitled song", message: "Untitled song" })}</SelectItem>)}</SelectContent>
        </Select></div>
      <div className="flex flex-col gap-2"><Label htmlFor="sound-start">{i18n._({ id: "Starts at (seconds)", message: "Starts at (seconds)" })}</Label>
        <Input id="sound-start" type="number" min={0} max={3600} step={0.5} value={start} onChange={event => setStart(event.currentTarget.value)} /></div>
      {problem ? <p role="alert" className="text-destructive text-sm">{problem}</p> : null}
      <Button type="button" disabled={!valid || working} onClick={add}>{working ? i18n._({ id: "Adding", message: "Adding" }) : i18n._({ id: "Add to the song", message: "Add to the song" })}</Button>
    </div>}
  </DialogContent></Dialog></div>;
}
