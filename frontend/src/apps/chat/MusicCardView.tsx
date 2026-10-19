import { useState, type ComponentProps } from "react";
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
  return length === "full" ? "Full: every part of the song." : "Quick: the hook. Make it full to sing every part.";
}

const etaLabel = (seconds: number | null) => seconds === null ? undefined : `about ${Math.max(1, Math.round(seconds))} seconds left`;
const descriptionOf = (card: MusicCard) => {
  const caption = (card.description ?? "").replace(/\s+/g, " ").trim();
  const style = caption.length > 70 ? `${caption.slice(0, 67).trimEnd()}...` : caption;
  const length = typeof card.duration_s === "number" && card.duration_s > 0 ? `${Math.floor(card.duration_s / 60)}:${String(Math.round(card.duration_s % 60)).padStart(2, "0")}` : "";
  return [card.length === "full" ? "Full song" : "Quick song", style, length].filter(Boolean).join(", ") || undefined;
};

/** The one rendering of Home's song player, shared by chat and the Library viewer. */
export function useMusicTrackProps({ card, owner = true, onRefresh, onStop, onShare, navigate }: { card: MusicCard; owner?: boolean; onRefresh?: () => void; onStop?: () => void; onShare?: () => void; navigate?: (path: string) => void }): ComponentProps<typeof MusicTrack> {
  const [picked, setPicked] = useState<{ base: string | null; id: string } | null>(null);
  const [songChange, setSongChange] = useState("");
  const [coverChange, setCoverChange] = useState("");
  const [editError, setEditError] = useState("");
  const [editing, setEditing] = useState(false);
  const status: MusicTrackStatus = card.state === "done" && card.versions.length ? "ready" : card.state === "queued" ? "queued" : card.state === "running" ? "generating" : card.state === "cancelled" ? "cancelled" : "failed";
  const shownId = picked && picked.base === card.current_id && card.versions.some(version => version.id === picked.id) ? picked.id : card.current_id;
  const shown = card.versions.find(version => version.id === shownId) ?? card.versions.at(-1);
  const title = card.title ?? "Your song";
  const ready = status === "ready" && shown !== undefined;
  const prepared = useQuery({ queryKey: ["music-share", shown?.url], queryFn: ({ signal }) => prepareClip(shown!.url, signal, { type: "audio/mp4", name: musicFileName(title) }), enabled: ready && !onShare, staleTime: Infinity, gcTime: 10 * 60_000, retry: false });
  const refresh = () => onRefresh?.();
  const editErrorText = (error: unknown) => `${error instanceof Error ? error.message : "Home could not make that change."} Check the request and try again.`;
  const editContent = owner && ready ? <>
    {card.length !== "full" ? <Button type="button" variant="outline" onClick={() => { setEditing(true); setEditError(""); void musicApi.setLength(card.id, "full", shown?.id).then(refresh).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); }} disabled={editing}>Make it full</Button> : null}
    <Input aria-label="How should it change? For example: make it heavy metal" placeholder="How should it change? For example: make it heavy metal" value={songChange} onChange={event => setSongChange(event.currentTarget.value)} maxLength={500} disabled={editing} />
    <Button type="button" variant="outline" disabled={editing || !songChange.trim()} onClick={() => { const change = songChange.trim(); if (!change || editing) return; setEditing(true); setEditError(""); void musicApi.revise(card.id, change, shown?.id).then(() => { setSongChange(""); refresh(); }).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); }}>Make</Button>
    <Input aria-label="Describe the new cover" placeholder="Describe the new cover" value={coverChange} onChange={event => setCoverChange(event.currentTarget.value)} maxLength={500} disabled={editing} />
    <Button type="button" variant="outline" disabled={editing || !coverChange.trim()} onClick={() => { const prompt = coverChange.trim(); if (!prompt || editing) return; setEditing(true); setEditError(""); void musicApi.newCover(card.id, prompt).then(() => { setCoverChange(""); refresh(); }).catch(error => setEditError(editErrorText(error))).finally(() => setEditing(false)); }}>Make</Button>
    {editError ? <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert> : null}
  </> : undefined;
  const lyrics = card.lyrics?.trim() === "[Instrumental]" ? undefined : card.lyrics ?? undefined;
  return { status, width: "full", ...(editContent ? { editContent, editLabel: "Edit", editPanelLabel: "Edit song" } : {}), title,
    ...(card.cover_url ? { cover: card.cover_url, coverAlt: `Cover art for ${title}` } : {}), ...(descriptionOf(card) ? { description: descriptionOf(card) } : {}), ...(ready ? { src: shown.url } : {}),
    progress: Math.round(card.progress * 100), ...(card.stage_label && card.state !== "queued" ? { phaseLabel: card.stage_label } : {}), ...(etaLabel(card.eta_seconds) ? { etaLabel: etaLabel(card.eta_seconds)! } : {}),
    queuePosition: card.position, startedAt: card.started_at, ...(card.error_line ? { error: card.error_line } : {}), downloadName: musicFileName(title), timedLyrics: card.timed_lyrics ?? undefined,
    ...(ready && lyrics ? { lyrics } : {}), ...(ready ? { versions: card.versions.map(version => ({ id: version.id, label: version.label })), ...(shownId ? { currentId: shownId } : {}) } : {}),
    onSelectVersion: id => setPicked({ base: card.current_id, id }), ...(owner ? { onUseVersion: (id: string) => { void musicApi.useVersion(card.id, id).then(refresh).catch(refresh); } } : {}), onStop,
    hint: musicHint(card.length, card.cut, card.max_seconds), ...(card.state === "queued" && card.stage === "longer" ? { copy: { queued: card.stage_label } } : {}),
    ...(owner && onShare && ready ? { onShare } : owner && navigate && ready ? { onShare: () => { void shareClip({ prepared: prepared.data, title, nav: navigator, fallback: () => navigate(`/files?file=${encodeURIComponent(shown.id)}`) }); } } : {}) };
}
