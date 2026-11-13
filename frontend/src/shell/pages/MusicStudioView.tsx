// MUSIC-STUDIO-VIEW-01 (MP-04): the Audio app's Studio of one song, drawn by the kit's `TrackStudio kind="audio"` (rows, waveforms, mute, solo, level, ruler,
// playhead, zoom, the EQ and Compressor panels and the range selection are the kit's). The rows are the full song and its stems once Home has split it
// (the existing stems action, the same one the chat card uses). Beside it, Effects: gain, speed, pitch, an EQ preset, reverse, remove silence, limit, echo,
// reverb and denoise on the selection or the whole song, and Apply for the Studio's own EQ and Compressor. Every Apply is an ffmpeg job in Home (MP-02) that makes
// a NEW version of the song; the earlier versions stay, Undo steps back to the one before and the Versions list switches. The Studio follows the person's theme.
// A locked song is the kit's one lock tile and nothing of it is read.
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { TrackStudio, defaultEffects, type StudioEffects, type StudioPanel, type StudioSelection } from "@maipai/ui/src/elements/track-studio";
import { errorLine } from "@/lib/hubReachability";
import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Slider } from "@maipai/ui/src/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { musicApi, type EffectBody, type MusicCard } from "@/lib/musicApi";
import { MAKE_SONG_ADULT_LINE } from "./MakeSongPage";
import { Cover } from "@maipai/ui/src/ui/media-tiles";
import { BringSong } from "./BringSong";
import { useMusicPlayer } from "@/shell/music/musicPlayer";
import { trackOf } from "./musicLibraryModel";
import { getIcon } from "@maipai/ui/src/icons";
import { EFFECT_CHOICES, EFFECT_SLIDERS, EQ_PRESET_CHOICES, compressBody, currentVersion, effectBody, eqBody, nextVersionId, previousVersionId, studioLanes, type EffectChoice } from "./musicStudioFx";

export const STEMS_UNAVAILABLE_LINE = () => i18n._({ id: "This computer has no stem model installed, so the song cannot be split. An admin can add one in Settings. The full song still plays here.", message: "This computer has no stem model installed, so the song cannot be split. An admin can add one in Settings. The full song still plays here." });
export const EFFECT_FAILED_LINE = () => i18n._({ id: "The change could not be made. Try again, or try a different part of the song.", message: "The change could not be made. Try again, or try a different part of the song." });
export const NO_AUDIO_TOOL_LINE = () => i18n._({ id: "This computer has no audio tool to change the sound. Install ffmpeg, then try again.", message: "This computer has no audio tool to change the sound. Install ffmpeg, then try again." });

/** m:ss for the selection and the length. */
export const timeLabel = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

const EFFECT_NAME: Record<EffectChoice, () => string> = {
  gain: () => i18n._({ id: "Volume", message: "Volume" }), speed: () => i18n._({ id: "Speed", message: "Speed" }), pitch: () => i18n._({ id: "Pitch", message: "Pitch" }),
  eq_preset: () => i18n._({ id: "EQ preset", message: "EQ preset" }), reverse: () => i18n._({ id: "Reverse", message: "Reverse" }), remove_silence: () => i18n._({ id: "Remove silence", message: "Remove silence" }),
  limit: () => i18n._({ id: "Limit peaks", message: "Limit peaks" }), echo: () => i18n._({ id: "Echo", message: "Echo" }), reverb: () => i18n._({ id: "Reverb", message: "Reverb" }), denoise: () => i18n._({ id: "Reduce noise", message: "Reduce noise" }),
};
const PRESET_NAME: Record<(typeof EQ_PRESET_CHOICES)[number], () => string> = {
  bass_boost: () => i18n._({ id: "Bass boost", message: "Bass boost" }), treble_boost: () => i18n._({ id: "Treble boost", message: "Treble boost" }),
  vocal_clarity: () => i18n._({ id: "Vocal clarity", message: "Vocal clarity" }), warm: () => i18n._({ id: "Warm", message: "Warm" }),
};

/** A card the hub answers for a locked song: no title, no files. */
const isLockedCard = (card: unknown): card is { locked: true; making: boolean } => !!card && typeof card === "object" && (card as { locked?: unknown }).locked === true;
const making = (card: MusicCard | undefined): boolean => !!card && !isLockedCard(card) && !!card.making_version;

/** The Studio view. `search` carries `song` (the song) and `stems` (the id of its stem split, once started). */
export function MusicStudioView({ adult, search }: { adult: boolean; search: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = new URLSearchParams(search);
  const songId = params.get("song"); const stemsId = params.get("stems");
  const song = useQuery({ queryKey: ["studio-song", songId], enabled: !!songId && adult, queryFn: () => musicApi.card(songId ?? ""),
    refetchInterval: (q) => { const card = q.state.data; return isLockedCard(card) ? (card.making ? 3000 : false) : card?.state === "done" && !card.making_version ? false : 3000; } });
  const stems = useQuery({ queryKey: ["studio-stems", stemsId], enabled: !!stemsId && adult, queryFn: () => musicApi.card(stemsId ?? ""), refetchInterval: (q) => (q.state.data && q.state.data.state !== "queued" && q.state.data.state !== "running" ? false : 3000) });
  const status = useQuery({ queryKey: ["music-status"], enabled: adult, queryFn: () => musicApi.status(), staleTime: 60_000 });
  const locked = isLockedCard(song.data);
  const card = locked ? undefined : song.data;
  const stemsCard = stems.data && !isLockedCard(stems.data) ? stems.data : undefined;
  const version = currentVersion(card);
  const player = useMusicPlayer();
  const studioTrack = card && version && card.state === "done" ? trackOf(card, version.id, i18n._({ id: "Untitled song", message: "Untitled song" })) : null;
  const studioPlaying = !!studioTrack && player.track?.key === studioTrack.key && player.playing;
  const PlayGlyph = getIcon(studioPlaying ? "pause" : "play");
  const [probed, setProbed] = useState<{ url: string; seconds: number } | null>(null);
  const duration = card?.duration_s ?? (probed && probed.url === version?.url ? probed.seconds : 0);
  useEffect(() => {
    if (!version || card?.duration_s || probed?.url === version.url) return;
    const audio = new Audio(); audio.preload = "metadata";
    audio.onloadedmetadata = () => { if (Number.isFinite(audio.duration) && audio.duration > 0) setProbed({ url: version.url, seconds: audio.duration }); };
    audio.src = version.url;
    return () => { audio.onloadedmetadata = null; audio.src = ""; };
  }, [version, card?.duration_s, probed?.url]);

  const [fx, setFx] = useState<StudioEffects>(defaultEffects());
  const [panel, setPanel] = useState<StudioPanel>("volume");
  const [selection, setSelection] = useState<StudioSelection | null>(null);
  const [choice, setChoice] = useState<EffectChoice>("gain");
  const [amounts, setAmounts] = useState<Partial<Record<EffectChoice, number>>>({});
  const [preset, setPreset] = useState<(typeof EQ_PRESET_CHOICES)[number]>("warm");
  const [sending, setSending] = useState(false); const [problem, setProblem] = useState("");
  const [splitting, setSplitting] = useState(false); const [stemsProblem, setStemsProblem] = useState("");
  const askedCount = useRef<number | null>(null);
  const makingNow = making(card);
  const versionCount = card?.versions.length ?? 0;
  // A change that ends with no new version has failed: the card then has no error of its own, so say it here.
  useEffect(() => {
    if (makingNow || askedCount.current === null) return;
    if (versionCount <= askedCount.current) setProblem(EFFECT_FAILED_LINE());
    askedCount.current = null;
  }, [makingNow, versionCount]);

  const autoSplit = params.get("split") === "1" && !stemsId && card?.state === "done";
  const asked = useRef(false);
  const splitInto = (id: string) => musicApi.stems(id).then((made) => navigate(`/apps/audio/studio?song=${encodeURIComponent(id)}&stems=${encodeURIComponent(made.id)}`, { replace: true }))
    .catch((error: unknown) => setStemsProblem(errorLine(error, STEMS_UNAVAILABLE_LINE()))).finally(() => setSplitting(false));
  useEffect(() => {
    if (!autoSplit || asked.current || !songId) return;
    asked.current = true; setSplitting(true); void splitInto(songId);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per song
  }, [autoSplit, songId]);

  if (!adult) return <EmptyState icon="music" text={MAKE_SONG_ADULT_LINE()} />;
  if (!songId) return <EmptyState icon="music" text={i18n._({ id: "Open a song from your list, then choose Studio.", message: "Open a song from your list, then choose Studio." })} actionLabel={i18n._({ id: "Open Create", message: "Open Create" })} onAction={() => navigate("/apps/audio/create")} />;
  if (song.isError) return <EmptyState icon="music" text={i18n._({ id: "That song is not here any more. It may have been removed from your Library.", message: "That song is not here any more. It may have been removed from your Library." })} actionLabel={i18n._({ id: "Open Create", message: "Open Create" })} onAction={() => navigate("/apps/audio/create")} />;

  const stemsBusy = !!stemsCard && (stemsCard.state === "queued" || stemsCard.state === "running");
  const lanes = studioLanes(card, stemsCard, duration);
  const hasStems = lanes.length > 1;
  const noTool = status.data?.file_effects === false;
  const busyReason = sending || makingNow ? i18n._({ id: "A change is being made. Wait for it to finish.", message: "A change is being made. Wait for it to finish." }) : "";
  const stopReason = busyReason || (noTool ? NO_AUDIO_TOOL_LINE() : "");
  const where = selection
    ? i18n._({ id: "Applies to the selection, {start} to {end}.", message: "Applies to the selection, {start} to {end}.", values: { start: timeLabel(selection.start_s), end: timeLabel(selection.end_s) } })
    : i18n._({ id: "Applies to the whole song. Drag on the ruler to pick a part.", message: "Applies to the whole song. Drag on the ruler to pick a part." });
  const previous = previousVersionId(card); const next = nextVersionId(card);

  const refresh = (made: MusicCard) => queryClient.setQueryData(["studio-song", songId], made);
  const apply = (body: EffectBody, done?: () => void) => {
    if (stopReason || sending) return;
    setSending(true); setProblem(""); askedCount.current = versionCount;
    musicApi.effect(songId, body).then((made) => { refresh(made); done?.(); setSelection(null); })
      .catch((error: unknown) => { askedCount.current = null; setProblem(errorLine(error, EFFECT_FAILED_LINE())); })
      .finally(() => setSending(false));
  };
  const switchTo = (fileId: string) => {
    if (busyReason) return;
    setProblem("");
    musicApi.useVersion(songId, fileId).then((made) => { refresh(made); setFx(defaultEffects()); setSelection(null); }).catch((error: unknown) => setProblem(errorLine(error, EFFECT_FAILED_LINE())));
  };
  const slider = EFFECT_SLIDERS[choice]; const amount = amounts[choice] ?? slider?.start ?? 0;
  const eqReason = fx.eq.every((gain) => Math.abs(gain) < 1e-9) ? i18n._({ id: "Move an EQ band in the EQ panel first.", message: "Move an EQ band in the EQ panel first." }) : "";
  const compReason = fx.compressor.ratio <= 1 && Math.abs(fx.compressor.makeup_db) < 1e-9 ? i18n._({ id: "Set a ratio above 1 or some make-up gain in the Compressor panel first.", message: "Set a ratio above 1 or some make-up gain in the Compressor panel first." }) : "";
  const undoReason = !previous ? i18n._({ id: "This is the first version. There is nothing to undo.", message: "This is the first version. There is nothing to undo." }) : busyReason;
  const redoReason = !next ? i18n._({ id: "This is the newest version. There is nothing to redo.", message: "This is the newest version. There is nothing to redo." }) : busyReason;
  const reasons = [stopReason && stopReason, panel === "eq" && eqReason, panel === "compressor" && compReason].filter(Boolean) as string[];

  const ready = !locked && lanes.length > 0;
  // The Studio is drawn as direct children (no box of Home's own around the TrackStudio, rule 9); the page that places this view gives them their column.
  return <>
    <BringSong mode="stems" adult={adult} />
    <div className="flex shrink-0 flex-wrap items-center gap-4">
      <div className="size-16 shrink-0 overflow-hidden rounded-xl sm:size-20"><Cover id={songId} title={card?.title ?? i18n._({ id: "Studio", message: "Studio" })} url={card?.cover_url ?? null} bare /></div>
      <div className="flex min-w-0 flex-1 flex-col gap-1"><p className="text-muted-foreground text-sm">{i18n._({ id: "Studio", message: "Studio" })}</p>
        <h2 className="min-w-0 truncate text-title">{locked ? i18n._({ id: "Locked song", message: "Locked song" }) : card?.title ?? i18n._({ id: "Studio", message: "Studio" })}</h2></div>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <Button type="button" variant="secondary" disabled={!studioTrack} title={studioTrack ? undefined : i18n._({ id: "Available once the song is finished.", message: "Available once the song is finished." })} aria-pressed={studioPlaying} data-testid="studio-play-in-bar" onClick={() => { if (studioTrack) player.toggle(studioTrack, player.queue); }}><PlayGlyph aria-hidden="true" />{studioPlaying ? i18n._({ id: "Pause", message: "Pause" }) : i18n._({ id: "Play in the player", message: "Play in the player" })}</Button>
        <Button asChild variant="secondary"><Link to={`/apps/audio/create?song=${encodeURIComponent(songId)}`}>{i18n._({ id: "Back to the song", message: "Back to the song" })}</Link></Button>
        <Button type="button" disabled={splitting || stemsBusy || hasStems || !card || card.state !== "done"} title={hasStems ? i18n._({ id: "This song is already split into stems.", message: "This song is already split into stems." }) : undefined}
          onClick={() => { setSplitting(true); setStemsProblem(""); void splitInto(songId); }}>{stemsBusy || splitting ? i18n._({ id: "Splitting into stems", message: "Splitting into stems" }) : hasStems ? i18n._({ id: "Split into stems (done)", message: "Split into stems (done)" }) : i18n._({ id: "Split into stems", message: "Split into stems" })}</Button>
      </div>
    </div>
    {stemsBusy || splitting ? <div data-testid="music-stems-progress"><StatusCard kind="progress" title={i18n._({ id: "Splitting into stems", message: "Splitting into stems" })} progress={stemsCard && stemsCard.progress > 0 ? Math.round(stemsCard.progress * 100) : undefined}
      line={i18n._({ id: "Vocals, drums, bass and the rest. This takes a minute or two. The rows appear here when it is done.", message: "Vocals, drums, bass and the rest. This takes a minute or two. The rows appear here when it is done." })} /></div> : null}
    {stemsCard?.state === "failed" ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={stemsCard.error_line || STEMS_UNAVAILABLE_LINE()} /> : null}
    {stemsProblem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={stemsProblem} /> : null}
    {makingNow ? <div data-testid="music-effect-progress"><StatusCard kind="progress" title={i18n._({ id: "Changing the sound", message: "Changing the sound" })} line={card?.making_version?.stage_label || i18n._({ id: "Making a new version. The first one stays.", message: "Making a new version. The first one stays." })}
      progress={card?.making_version && card.making_version.progress > 0 ? Math.round(card.making_version.progress * 100) : undefined} /></div> : null}
    {problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={problem} /> : null}
    {locked ? <TrackStudio lanes={[]} kind="audio" locked lockedMaking={isLockedCard(song.data) && song.data.making} /> : null}
    {!locked && !ready ? <p role="status" className="text-muted-foreground text-sm">{card?.state === "failed" ? i18n._({ id: "This song could not be made, so there is nothing to open.", message: "This song could not be made, so there is nothing to open." }) : i18n._({ id: "Opening your song. The Studio shows it as soon as it is made.", message: "Opening your song. The Studio shows it as soon as it is made." })}</p> : null}
    {ready ? <TrackStudio kind="audio" lanes={lanes} resetKey={`${songId}|${version?.id}|${hasStems ? stemsId : ""}`} title={card?.title ?? undefined} tools={[]}
      effects={fx} onEffectsChange={(next) => setFx(next)} effectsDisabledReason={stopReason || undefined} onPanelChange={setPanel} selection={selection} onSelectionChange={setSelection} /> : null}
    {ready ? <div data-testid="studio-timeline" className="flex flex-col gap-4">
    <div className="bg-card flex flex-col gap-3 rounded-2xl p-4" data-testid="studio-effects">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-section">{i18n._({ id: "Effects", message: "Effects" })}</h3><p className="text-muted-foreground text-sm" data-testid="studio-effect-scope">{where}</p></div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-44 flex-col gap-1.5"><span className="text-muted-foreground text-xs font-medium">{i18n._({ id: "Effect", message: "Effect" })}</span>
          <Select value={choice} onValueChange={(value: string) => setChoice(value as EffectChoice)} disabled={!!stopReason}>
            <SelectTrigger aria-label={i18n._({ id: "Choose an effect", message: "Choose an effect" })} width="full"><SelectValue /></SelectTrigger>
            <SelectContent>{EFFECT_CHOICES.map((id) => <SelectItem key={id} value={id}>{EFFECT_NAME[id]()}</SelectItem>)}</SelectContent>
          </Select></div>
        {slider ? <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs"><span className="text-muted-foreground font-medium">{EFFECT_NAME[choice]()}</span><span className="tabular-nums">{amount}{slider.unit}</span></div>
          <Slider aria-label={EFFECT_NAME[choice]()} min={slider.min} max={slider.max} step={slider.step} value={[amount]} disabled={!!stopReason} onValueChange={(value) => setAmounts({ ...amounts, [choice]: value[0] ?? amount })} /></div> : null}
        {choice === "eq_preset" ? <div className="flex min-w-44 flex-col gap-1.5"><span className="text-muted-foreground text-xs font-medium">{i18n._({ id: "Preset", message: "Preset" })}</span>
          <Select value={preset} onValueChange={(value: string) => setPreset(value as (typeof EQ_PRESET_CHOICES)[number])} disabled={!!stopReason}>
            <SelectTrigger aria-label={i18n._({ id: "Choose an EQ preset", message: "Choose an EQ preset" })} width="full"><SelectValue /></SelectTrigger>
            <SelectContent>{EQ_PRESET_CHOICES.map((id) => <SelectItem key={id} value={id}>{PRESET_NAME[id]()}</SelectItem>)}</SelectContent>
          </Select></div> : null}
        <Button type="button" disabled={!!stopReason} onClick={() => apply(effectBody(choice, { amount, preset }, selection))}>{i18n._({ id: "Apply effect", message: "Apply effect" })}</Button>
        <Button type="button" variant="secondary" disabled={!!undoReason} title={undoReason || undefined} onClick={() => previous && switchTo(previous)}>{i18n._({ id: "Undo", message: "Undo" })}</Button>
        <Button type="button" variant="secondary" disabled={!!redoReason} title={redoReason || undefined} onClick={() => next && switchTo(next)}>{i18n._({ id: "Redo", message: "Redo" })}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={!!stopReason || !!eqReason} title={stopReason || eqReason || undefined} onClick={() => apply(eqBody(fx, selection), () => setFx({ ...fx, eq: defaultEffects().eq }))}>{i18n._({ id: "Apply EQ", message: "Apply EQ" })}</Button>
        <Button type="button" variant="outline" disabled={!!stopReason || !!compReason} title={stopReason || compReason || undefined} onClick={() => apply(compressBody(fx, selection), () => setFx({ ...fx, compressor: defaultEffects().compressor }))}>{i18n._({ id: "Apply compressor", message: "Apply compressor" })}</Button>
        <p className="text-muted-foreground text-xs">{i18n._({ id: "The EQ and Compressor panels let you listen first. Apply makes a new version; the earlier ones stay.", message: "The EQ and Compressor panels let you listen first. Apply makes a new version; the earlier ones stay." })}</p>
      </div>
      {reasons.length ? <p className="text-muted-foreground text-xs" data-testid="studio-disabled-reason">{reasons[0]}</p> : null}
    </div>
    <div className="bg-card flex flex-col gap-3 rounded-2xl p-4" data-testid="studio-versions">
      <h3 className="text-section">{i18n._({ id: "Versions", message: "Versions" })}</h3>
      <div className="flex flex-wrap gap-2">
        {card?.versions.map((entry) => <Button key={entry.id} type="button" size="sm" variant={entry.id === version?.id ? "default" : "outline"} aria-pressed={entry.id === version?.id} disabled={!!busyReason && entry.id !== version?.id} onClick={() => entry.id !== version?.id && switchTo(entry.id)}>{entry.label}</Button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="studio-download">
        <span className="text-muted-foreground text-sm">{i18n._({ id: "Download this version", message: "Download this version" })}</span>
        {version ? <Button asChild size="sm" variant="secondary"><a href={musicApi.exportUrl(version.id, "m4a")} download>M4A</a></Button> : null}
        {(["wav", "flac"] as const).map((format) => version && !noTool ? <Button key={format} asChild size="sm" variant="secondary"><a href={musicApi.exportUrl(version.id, format)} download>{format.toUpperCase()}</a></Button>
          : <Button key={format} type="button" size="sm" variant="secondary" disabled title={NO_AUDIO_TOOL_LINE()}>{format.toUpperCase()}</Button>)}
      </div>
    </div>

    </div> : null}
  </>;
}
