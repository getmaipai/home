import { useEffect, useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { MusicTrack } from "@maipai/ui/src/elements/music-track";
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

const descriptionOf = (card: MusicCard) => {
  const caption = (card.description ?? "").replace(/\s+/g, " ").trim();
  const style = caption.length > 70 ? `${caption.slice(0, 67).trimEnd()}...` : caption;
  const length = typeof card.duration_s === "number" && card.duration_s > 0 ? `${Math.floor(card.duration_s / 60)}:${String(Math.round(card.duration_s % 60)).padStart(2, "0")}` : "";
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
  const shownId = picked && picked.base === card.current_id && card.versions.some(version => version.id === picked.id) ? picked.id : card.current_id;
  const shown = card.versions.find(version => version.id === shownId) ?? card.versions.at(-1);
  const songTitle = card.title ?? "Your song";
  const title = card.task === "stems" && shown ? `${songTitle.replace(/ \([^)]*\)$/, "")} (${shown.label.toLowerCase()})` : songTitle;
  const ready = status === "ready" && shown !== undefined;
  const prepared = useQuery({ queryKey: ["music-share", shown?.url], queryFn: ({ signal }) => prepareClip(shown!.url, signal, { type: "audio/mp4", name: musicFileName(title) }), enabled: ready && !onShare, staleTime: Infinity, gcTime: 10 * 60_000, retry: false });
  const refresh = () => onRefresh?.();
  const editErrorText = (error: unknown) => `${error instanceof Error ? error.message : "Home could not make that change."} Check the request and try again.`;
  const makeFull = () => { if (editing) return; setEditing(true); setEditError(""); void musicApi.setLength(card.id, "full", shown?.id).then(refresh).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  const makeQuick = () => { if (editing) return; setEditing(true); setEditError(""); void musicApi.setLength(card.id, "quick", shown?.id).then(refresh).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  const makeChange = () => { const change = songChange.trim(); if (!change || editing) return; setEditing(true); setEditError(""); void musicApi.revise(card.id, change, shown?.id).then(() => { setSongChange(""); refresh(); }).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  const makeCover = () => { const prompt = coverChange.trim(); if (!prompt || editing) return; setEditing(true); setEditError(""); void musicApi.newCover(card.id, prompt).then(() => { setCoverChange(""); refresh(); }).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  const makeStems = () => { if (editing || generating || card.task === "stems") return; setEditing(true); setEditError(""); void musicApi.stems(card.id, shown?.id).then(() => { refresh(); onStemsStarted?.(); }).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); };
  const editModes = owner && ready && card.task !== "stems" ? [
    { id: "song", label: "Remix", content: <><div className="grid gap-2"><Input aria-label="How should it change? For example: heavy metal" placeholder="How should it change? For example: heavy metal" value={songChange} onChange={event => setSongChange(event.currentTarget.value)} maxLength={500} disabled={editing} /><Button type="button" variant="outline" disabled={editing || !songChange.trim()} onClick={makeChange}>Remix</Button></div>{editError ? <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert> : null}</>, ...((editing || !songChange.trim()) ? { disabledReason: editing ? "Wait for the current change to finish." : "Describe a song change to enable Remix." } : {}) },
    { id: "cover", label: "New cover", content: <><div className="grid gap-2"><Input aria-label="Describe the new cover" placeholder="Describe the new cover" value={coverChange} onChange={event => setCoverChange(event.currentTarget.value)} maxLength={500} disabled={editing} /><Button type="button" variant="outline" disabled={editing || !coverChange.trim()} onClick={makeCover}>Make new cover</Button></div>{editError ? <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert> : null}</>, ...((editing || !coverChange.trim()) ? { disabledReason: editing ? "Wait for the current change to finish." : "Describe a new cover to enable Make new cover." } : {}) },
    { id: "full", label: "Full song", content: <>{card.length !== "full" ? <><Button type="button" variant="outline" onClick={makeFull} disabled={editing}>Full song</Button><p className="text-muted-foreground text-sm">Sings every verse</p></> : <Button type="button" variant="outline" onClick={makeQuick} disabled={editing}>Quick song</Button>}{editError ? <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert> : null}</>, ...(editing ? { disabledReason: "Wait for the current change to finish." } : {}) },
    { id: "stems", label: "Stems", content: <><Button type="button" variant="outline" onClick={makeStems} disabled={editing || generating}>Split into stems</Button>{editError ? <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert> : null}</>, ...((editing || generating) ? { disabledReason: "Wait for the song to finish before splitting it into stems." } : {}) },
  ] : undefined;
  const cardStarted = Number.isFinite(card.started_at) && card.started_at > 0 ? card.started_at : NaN;
  const elapsedSeconds = Number.isFinite(cardStarted) ? Math.max(0, Math.floor((now - cardStarted) / 1000)) : undefined;
  const lyrics = card.lyrics?.trim() === "[Instrumental]" ? undefined : card.lyrics ?? undefined;
  return { status, width: "full", ...(editModes ? { editModes, editLabel: "Edit", editPanelLabel: "Edit song" } : {}), title,
    ...(card.cover_url ? { cover: card.cover_url, coverAlt: `Cover art for ${title}` } : {}), ...(descriptionOf(card) ? { description: descriptionOf(card) } : {}), ...(ready ? { src: shown.url } : {}),
    stages: card.stages, currentStage: card.stage_index, progress: card.progress, ...(generating && elapsedSeconds !== undefined ? { elapsedSeconds } : {}), ...(card.eta_seconds !== null ? { etaSeconds: card.eta_seconds } : {}),
    ...(card.stage_label ? { phaseLabel: card.stage_label } : {}), waitingForMemory: card.state === "queued" && card.stage !== "longer",
    queuePosition: card.state === "queued" && card.stage !== "longer" ? null : card.position, ...(card.error_line ? { error: card.error_line } : {}), downloadName: musicFileName(title), timedLyrics: card.timed_lyrics ?? undefined,
    ...(ready && lyrics ? { lyrics } : {}), ...(ready ? { versions: card.versions.map(version => ({ id: version.id, label: version.label })), ...(shownId ? { currentId: shownId } : {}) } : {}),
    onSelectVersion: id => setPicked({ base: card.current_id, id }), ...(owner && card.task !== "stems" ? { onUseVersion: (id: string) => { void musicApi.useVersion(card.id, id).then(refresh).catch(refresh); } } : {}), onStop,
    hint: card.state === "queued" && card.stage === "longer" ? card.stage_label : musicHint(card.length, card.cut, card.max_seconds), ...(card.state === "queued" && card.stage !== "longer" ? { copy: { waitingForMemory: typeof card.position === "number" ? `Waiting for memory, your song starts when there is room. You are number ${card.position} in line.` : "Waiting for memory, your song starts when there is room" } } : {}),
    ...(card.task === "stems" && ready ? { copy: { versionOf: (n: number, total: number) => `Track ${n} of ${total}` } } : {}),
    ...(owner && onShare && ready ? { onShare } : owner && navigate && ready ? { onShare: () => { void shareClip({ prepared: prepared.data, title, nav: navigator, fallback: () => navigate(`/files?file=${encodeURIComponent(shown.id)}`) }); } } : {}) };
}
