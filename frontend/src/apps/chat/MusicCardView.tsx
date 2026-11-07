import { i18n } from "@lingui/core";
import { useEffect, useState, type ComponentProps } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { Label } from "@maipai/ui/src/ui/label";
import { TierSegment } from "@maipai/ui/src/elements/tier-segment";
import { fitAskActions } from "@/lib/fitAsk";
import { MusicTrack } from "@maipai/ui/src/elements/music-track";
import { Switch } from "@maipai/ui/src/ui/switch";
import type { MusicTrackStatus } from "@maipai/ui/src/elements/music-track";
import { musicApi, type MusicCard } from "@/lib/musicApi";
import { prepareClip, shareClip } from "@/lib/shareClip";
export function musicFileName(title: string | null | undefined): string {
  const base = (title ?? "").replace(/[^\p{L}\p{N} _-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return `${base || "song"}.m4a`;
}
export function musicHint(length: "quick" | "full", cut: MusicCard["cut"] = null, maxSeconds: number | null = null): string {
  if (cut === "ceiling" && maxSeconds !== null) return `Longer than this computer's longest song (${maxSeconds / 60} minutes), so it sings the first parts that fit.`;
  return length === "full" ? "Full: every part of the song." : "Quick: the hook. Choose Full song to sing every verse.";
}

/** The line under a sound: whether it loops, and when the length or the loop could not be shaped on this computer. */
export function soundHintOf(card: MusicCard): string {
  const notes: string[] = [];
  if (card.sound?.loop && card.sound.looped === false) notes.push(i18n._({ id: "The loop is not seamless: this computer has no audio tool to blend the ends. Install ffmpeg, then make it again.", message: "The loop is not seamless: this computer has no audio tool to blend the ends. Install ffmpeg, then make it again." }));
  if (card.sound?.trimTo && card.sound.trimmed === false) notes.push(i18n._({ id: "The sound is longer than asked: this computer has no audio tool to cut it. Install ffmpeg, then make it again.", message: "The sound is longer than asked: this computer has no audio tool to cut it. Install ffmpeg, then make it again." }));
  return notes.join(" ");
}
export const soundCardCopy = { saveToLibrary: "Save to Sounds", makeAnother: "Make another take", generating: "Making the sound", failed: "I couldn't make that sound.", queued: "Waiting its turn" };

const descriptionOf = (card: MusicCard) => {
  const caption = (card.description ?? "").replace(/\s+/g, " ").trim();
  const style = caption.length > 70 ? `${caption.slice(0, 67).trimEnd()}...` : caption;
  const length = typeof card.duration_s === "number" && card.duration_s > 0 ? `${Math.floor(card.duration_s / 60)}:${String(Math.round(card.duration_s % 60)).padStart(2, "0")}` : "";
  if (card.made_from_file) return ["Made from your file", length].filter(Boolean).join(", ");
  return [card.length === "full" ? "Full song" : "Quick song", style, length].filter(Boolean).join(", ") || undefined;
};

/** The one rendering of Home's song player, shared by chat and the Library viewer. */
export function useMusicTrackProps({ card, owner = true, onRefresh, onStemsStarted, onStop, onShare, navigate }: { card: MusicCard; owner?: boolean; onRefresh?: () => void; onStemsStarted?: () => void; onStop?: () => void; onShare?: () => void; navigate?: (path: string) => void }): ComponentProps<typeof MusicTrack> {
  const [now, setNow] = useState(() => Date.now());
  const generating = card.state === "running";
  useEffect(() => {
    if (!generating) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [generating]);
  const [picked, setPicked] = useState<{ base: string | null; id: string } | null>(null);
  const [songChange, setSongChange] = useState("");
  const [coverChange, setCoverChange] = useState("");
  const [editError, setEditError] = useState("");
  const [editing, setEditing] = useState(false);
  const status: MusicTrackStatus = card.state === "done" && card.versions.length ? "ready" : card.state === "queued" ? "queued" : card.state === "running" ? "generating" : card.state === "cancelled" ? "cancelled" : "failed";
  const isSound = card.sound != null;
  const queryClient = useQueryClient();
  const shownId = picked && picked.base === card.current_id && card.versions.some(version => version.id === picked.id) ? picked.id : card.current_id;
  const shown = card.versions.find(version => version.id === shownId) ?? card.versions.at(-1);
  const songTitle = card.title ?? "Your song";
  const title = card.task === "stems" && shown ? `${songTitle.replace(/ \([^)]*\)$/, "")} (${shown.label.toLowerCase()})` : songTitle;
  const ready = status === "ready" && shown !== undefined;
  const prepared = useQuery({ queryKey: ["music-share", shown?.url], queryFn: ({ signal }) => prepareClip(shown!.url, signal, { type: "audio/mp4", name: musicFileName(title) }), enabled: ready && !onShare && !isSound, staleTime: Infinity, gcTime: 10 * 60_000, retry: false });
  // The edit dialog covers the card, so it closes once a change is sent and the card shows the new version being made.
  const [editOpen, setEditOpen] = useState(false);
  const refresh = () => { setEditOpen(false); onRefresh?.(); };
  const editErrorText = (error: unknown) => `${error instanceof Error ? error.message : "Home could not make that change."} Check the request and try again.`;
  const makeFull = () => { if (editing) return; setEditing(true); setEditError(""); void musicApi.setLength(card.id, "full", shown?.id).then(refresh).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  const makeQuick = () => { if (editing) return; setEditing(true); setEditError(""); void musicApi.setLength(card.id, "quick", shown?.id).then(refresh).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  const makeTier = (tier: "standard" | "boost" | "max") => { if (editing) return; setEditing(true); setEditError(""); void musicApi.setTier(card.id, tier, shown?.id).then(refresh).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  const makeChange = () => { const change = songChange.trim(); if (!change || editing) return; setEditing(true); setEditError(""); void musicApi.revise(card.id, change, shown?.id).then(() => { setSongChange(""); refresh(); }).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  const makeCover = () => { const prompt = coverChange.trim(); if (!prompt || editing) return; setEditing(true); setEditError(""); void musicApi.newCover(card.id, prompt).then(() => { setCoverChange(""); refresh(); }).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  const makeStems = () => { if (editing || generating || card.task === "stems") return; setEditing(true); setEditError(""); void musicApi.stems(card.id, shown?.id).then(() => { refresh(); onStemsStarted?.(); }).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  // MUSIC-STUDIO-SONG: change the title, the words or the style and make a new version; the earlier versions stay on the card (also what edit_music does in chat).
  const [draft, setDraft] = useState<{ base: string | null; title?: string; lyrics?: string; style?: string }>({ base: null });
  const mine = draft.base === shownId ? draft : { base: shownId };
  const storedWords = card.lyrics?.trim() === "[Instrumental]" ? "" : card.lyrics ?? "";
  const titleValue = mine.title ?? card.title ?? ""; const lyricsValue = mine.lyrics ?? storedWords; const styleValue = mine.style ?? card.description ?? "";
  const detailChanges = { ...(titleValue.trim() && titleValue.trim() !== (card.title ?? "") ? { title: titleValue.trim() } : {}), ...(lyricsValue.trim() && lyricsValue !== storedWords ? { lyrics: lyricsValue } : {}), ...(styleValue.trim().length >= 3 && styleValue.trim() !== (card.description ?? "").trim() ? { description: styleValue.trim() } : {}) };
  const changed = Object.keys(detailChanges).length > 0;
  const saveDetails = () => { if (!changed || editing) return; setEditing(true); setEditError(""); void musicApi.details(card.id, detailChanges, shown?.id).then(() => { setDraft({ base: null }); refresh(); }).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  const detailsMode = { id: "details", label: "Details", content: <><div className="grid gap-3"><div className="grid gap-1"><Label htmlFor={`song-title-${card.id}`}>{i18n._({ id: "Title", message: "Title" })}</Label><Input id={`song-title-${card.id}`} value={titleValue} onChange={event => setDraft({ ...mine, title: event.currentTarget.value })} maxLength={200} disabled={editing} /></div><div className="grid gap-1"><Label htmlFor={`song-style-${card.id}`}>{i18n._({ id: "Style", message: "Style" })}</Label><Input id={`song-style-${card.id}`} value={styleValue} onChange={event => setDraft({ ...mine, style: event.currentTarget.value })} maxLength={1200} disabled={editing} /></div><div className="grid gap-1"><Label htmlFor={`song-words-${card.id}`}>{i18n._({ id: "Lyrics", message: "Lyrics" })}</Label><Textarea id={`song-words-${card.id}`} value={lyricsValue} rows={6} onChange={event => setDraft({ ...mine, lyrics: event.currentTarget.value })} maxLength={4000} disabled={editing} /></div><Button type="button" variant="outline" disabled={editing || !changed} onClick={saveDetails}>{i18n._({ id: "Make a new version", message: "Make a new version" })}</Button><p className="text-muted-foreground text-sm">{i18n._({ id: "Your earlier version stays on this card.", message: "Your earlier version stays on this card." })}</p></div>{editError ? <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert> : null}</>, ...(editing || !changed ? { disabledReason: editing ? "Wait for the current change to finish." : "Change the title, the style or the words to make a new version." } : {}) };
  const editModes = owner && ready && !isSound && card.task !== "stems" ? [
    { id: "song", label: "Remix", content: <><div className="grid gap-2"><Input aria-label={i18n._({ id: "How should it change? For example: heavy metal", message: "How should it change? For example: heavy metal" })} placeholder={i18n._({ id: "How should it change? For example: heavy metal", message: "How should it change? For example: heavy metal" })} value={songChange} onChange={event => setSongChange(event.currentTarget.value)} maxLength={500} disabled={editing} /><Button type="button" variant="outline" disabled={editing || !songChange.trim()} onClick={makeChange}>{i18n._({ id: "Remix", message: "Remix" })}</Button></div>{editError ? <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert> : null}</>, ...((editing || !songChange.trim()) ? { disabledReason: editing ? "Wait for the current change to finish." : "Describe a song change to enable Remix." } : {}) },
    { id: "cover", label: "New cover", content: <><div className="grid gap-2"><Input aria-label={i18n._({ id: "Describe the new cover", message: "Describe the new cover" })} placeholder={i18n._({ id: "Describe the new cover", message: "Describe the new cover" })} value={coverChange} onChange={event => setCoverChange(event.currentTarget.value)} maxLength={500} disabled={editing} /><Button type="button" variant="outline" disabled={editing || !coverChange.trim()} onClick={makeCover}>{i18n._({ id: "Make new cover", message: "Make new cover" })}</Button></div>{editError ? <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert> : null}</>, ...((editing || !coverChange.trim()) ? { disabledReason: editing ? "Wait for the current change to finish." : "Describe a new cover to enable Make new cover." } : {}) },
    { id: "full", label: "Full song", content: <>{card.length !== "full" ? <><Button type="button" variant="outline" onClick={makeFull} disabled={editing}>{i18n._({ id: "Full song", message: "Full song" })}</Button><p className="text-muted-foreground text-sm">{i18n._({ id: "Sings every verse", message: "Sings every verse" })}</p></> : <Button type="button" variant="outline" onClick={makeQuick} disabled={editing}>{i18n._({ id: "Quick song", message: "Quick song" })}</Button>}{editError ? <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert> : null}</>, ...(editing ? { disabledReason: "Wait for the current change to finish." } : {}) },
    ...(card.boost_offered || card.max_offered ? [{ id: "quality", label: "Quality", content: <><TierSegment label={i18n._({ id: "Quality", message: "Quality" })} value={card.quality === "max" ? "max" : card.quality === "detailed" ? "boost" : "standard"} onValueChange={makeTier} tiers={[{ id: "standard", label: "Standard", hint: "Faster" }, ...(card.boost_offered ? [{ id: "boost" as const, label: "Boost", hint: "Richer sound, a little slower" }] : []), ...(card.max_offered ? [{ id: "max" as const, label: "Max", hint: "The best sound, much slower", ...(card.max_installed ? { confirm: "Max uses the whole computer. Other big jobs wait, and Home goes back to normal by itself when it is done. Continue?" } : { disabledReason: "The Max music model is not installed yet. An admin can add it in Settings, Models and storage." }) }] : [])]} />{editError ? <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert> : null}</>, ...(editing ? { disabledReason: "Wait for the current change to finish." } : {}) }] : []),
    { id: "stems", label: "Stems", content: <><Button type="button" variant="outline" onClick={makeStems} disabled={editing || generating}>{i18n._({ id: "Split into stems", message: "Split into stems" })}</Button>{editError ? <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert> : null}</>, ...((editing || generating) ? { disabledReason: "Wait for the song to finish before splitting it into stems." } : {}) },
    detailsMode,
  ] : undefined;
  const cardStarted = Number.isFinite(card.started_at) && card.started_at > 0 ? card.started_at : NaN;
  const elapsedSeconds = Number.isFinite(cardStarted) ? Math.max(0, Math.floor((now - cardStarted) / 1000)) : undefined;
  const lyrics = card.lyrics?.trim() === "[Instrumental]" ? undefined : card.lyrics ?? undefined;
  const pendingActions = status === "queued" ? fitAskActions(card.fit_ask, refresh) : undefined;
  return { status, width: "full", ...(pendingActions ? { pendingActions } : {}), ...(editModes ? { editModes, editLabel: "Edit", editPanelLabel: "Edit song", editOpen, onEditOpenChange: setEditOpen } : {}), title: isSound ? (card.title ?? "Your sound") : title,
    ...(!isSound && card.cover_url ? { cover: card.cover_url, coverAlt: `Cover art for ${title}` } : {}), ...(isSound ? { description: (card.description ?? "").replace(/^sound effect, no melody, no singing: /, "").replace(/, seamless loop$/, "") || undefined } : descriptionOf(card) ? { description: descriptionOf(card) } : {}), ...(ready ? { src: shown.url } : {}),
    stages: card.stages, currentStage: card.stage_index, progress: card.progress, ...(generating && elapsedSeconds !== undefined ? { elapsedSeconds } : {}), ...(card.eta_seconds !== null ? { etaSeconds: card.eta_seconds } : {}),
    ...(card.stage_label ? { phaseLabel: card.stage_label } : {}), waitingForMemory: card.state === "queued" && card.stage !== "longer",
    queuePosition: card.state === "queued" && card.stage !== "longer" ? null : card.position, ...(card.error_line ? { error: card.error_line } : {}), downloadName: isSound ? "sound.m4a" : musicFileName(title), timedLyrics: isSound ? undefined : card.timed_lyrics ?? undefined,
    ...(!isSound && ready && lyrics ? { lyrics } : {}), ...(ready ? { versions: card.versions.map(version => ({ id: version.id, label: version.label })), ...(shownId ? { currentId: shownId } : {}) } : {}),
    ...(!isSound ? { onSelectVersion: (id: string) => setPicked({ base: card.current_id, id }) } : {}), ...(owner && !isSound && card.task !== "stems" ? { onUseVersion: (id: string) => { void musicApi.useVersion(card.id, id).then(refresh).catch(refresh); } } : {}), onStop,
    hint: isSound ? soundHintOf(card) : card.state === "queued" && card.stage === "longer" ? card.stage_label : musicHint(card.length, card.cut, card.max_seconds), ...(isSound ? { copy: soundCardCopy, onSaveToLibrary: owner ? () => { void musicApi.saveSound(card.id).then(() => { void queryClient.invalidateQueries({ queryKey: ["music-sounds"] }); onRefresh?.(); }).catch(() => onRefresh?.()); } : undefined, onMakeAnother: navigate ? () => navigate("/apps/music/create") : undefined, actions: <div className="flex items-center gap-2"><Switch checked={!!card.sound?.loop} disabled aria-label={i18n._({ id: "Loop", message: "Loop" })} /><span className="text-muted-foreground text-base">{card.sound?.loop ? (card.sound.looped === false ? i18n._({ id: "Loop is not seamless: this computer has no audio tool to blend the ends", message: "Loop is not seamless: this computer has no audio tool to blend the ends" }) : i18n._({ id: "Loops without a seam", message: "Loops without a seam" })) : i18n._({ id: "Plays once", message: "Plays once" })}</span></div> } : {}), ...(card.state === "queued" && card.stage !== "longer" ? { copy: { waitingForMemory: typeof card.position === "number" ? `Waiting for memory, your song starts when there is room. You are number ${card.position} in line.` : "Waiting for memory, your song starts when there is room" } } : {}),
    ...(card.task === "stems" && ready ? { copy: { versionOf: (n: number, total: number) => `Track ${n} of ${total}` } } : {}),
    ...(!isSound && owner && onShare && ready ? { onShare } : !isSound && owner && navigate && ready ? { onShare: () => { void shareClip({ prepared: prepared.data, title, nav: navigator, fallback: () => navigate(`/files?file=${encodeURIComponent(shown.id)}`) }); } } : {}) };
}
