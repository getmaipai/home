import { i18n } from "@lingui/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Roster } from "@/lib/api";
import { useAudioSession } from "@/shell/audioSessionContext";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";
import { skipSourceLabel } from "@/shell/skip/skipPlan";

const segmentKindLabel = (kind: string) => ({ ad: i18n._({ id: "Ad", message: "Ad" }), sponsor: i18n._({ id: "Sponsor", message: "Sponsor" }), bumper: i18n._({ id: "Break bumper", message: "Break bumper" }), selfpromo: i18n._({ id: "Self-promotion", message: "Self-promotion" }), intro: i18n._({ id: "Intro", message: "Intro" }), outro: i18n._({ id: "Outro", message: "Outro" }), recap: i18n._({ id: "Recap", message: "Recap" }), filler: i18n._({ id: "Filler", message: "Filler" }) }[kind] ?? kind);
const segmentStatusLabel = (status: string) => ({ auto: i18n._({ id: "Automatic", message: "Automatic" }), held: i18n._({ id: "Needs review", message: "Needs review" }), confirmed: i18n._({ id: "Confirmed", message: "Confirmed" }), rejected: i18n._({ id: "Rejected", message: "Rejected" }) }[status] ?? status);
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function PodcastSegmentsPage({ person, id }: { person: Roster; id: string }) {
  const queryClient = useQueryClient();
  const session = useAudioSession();
  const [markStart, setMarkStart] = useState<number | null>(null);
  const [pendingRange, setPendingRange] = useState<{ start: number; end: number } | null>(null);
  const [message, setMessage] = useState("");
  const query = useQuery({ queryKey: ["podcast-segments", id], queryFn: () => api.podcastSegments(id), enabled: Boolean(id) && person.age_band === "adult", retry: false });
  const correction = useMutation({ mutationFn: (input: { segment_id: string; rejected: boolean }) => api.correctPodcastSegment(id, { record_id: query.data?.record_id ?? "", ...input }), onSuccess: () => { setMessage(i18n._({ id: "Your correction was sent to Stack.", message: "Your correction was sent to Stack." })); void queryClient.invalidateQueries({ queryKey: ["podcast-segments", id] }); }, onError: () => setMessage(i18n._({ id: "Stack could not save that correction. Check that it is online, then try again.", message: "Stack could not save that correction. Check that it is online, then try again." })) });
  const missing = useMutation({ mutationFn: (range: { start: number; end: number }) => api.reportMissingPodcastAd(id, range), onSuccess: () => { setMessage(i18n._({ id: "Missed ad report sent to Stack.", message: "Missed ad report sent to Stack." })); setPendingRange(null); void queryClient.invalidateQueries({ queryKey: ["podcast-segments", id] }); }, onError: () => setMessage(i18n._({ id: "Stack could not save that report. Retry to send the marked range.", message: "Stack could not save that report. Retry to send the marked range." })) });
  const canReview = person.age_band === "adult";
  if (!canReview) return null;
  if (query.isPending) return <p role="status">{i18n._({ id: "Loading episode segments…", message: "Loading episode segments…" })}</p>;
  if (query.isError) return <section><Alert variant="destructive"><AlertDescription>{i18n._({ id: "Could not load this episode’s segment details. Playback is still available; reload to try again.", message: "Could not load this episode’s segment details. Playback is still available; reload to try again." })}</AlertDescription></Alert></section>;
  const data = query.data;
  if (!data || data.state === "not_processed") return <p className="text-body text-muted-foreground">{i18n._({ id: "This saved episode has not been analyzed yet. Save a copy to check for breaks.", message: "This saved episode has not been analyzed yet. Save a copy to check for breaks." })}</p>;
  if (data.state === "queued" || data.state === "processing") return <p role="status" className="text-body text-muted-foreground">{i18n._({ id: "Processing. You can keep listening while Stack checks this saved copy.", message: "Processing. You can keep listening while Stack checks this saved copy." })}</p>;
  if (data.state === "offline" || data.state === "unavailable") return <section><Alert variant="destructive"><AlertDescription>{data.reason ?? i18n._({ id: "Stack is offline. Playback remains available; try again later.", message: "Stack is offline. Playback remains available; try again later." })}</AlertDescription></Alert></section>;
  const segments = [...(data.segments ?? [])].sort((a, b) => a.start - b.start);
  const saveMissingRange = (end: number) => {
    if (markStart === null || end <= markStart) { setMessage(i18n._({ id: "Mark an end time after the start time, then send the range.", message: "Mark an end time after the start time, then send the range." })); return; }
    const range = { start: markStart, end };
    setPendingRange(range); setMarkStart(null); missing.mutate(range);
  };
  return <section className="flex flex-col gap-3" aria-label={i18n._({ id: "Episode segments", message: "Episode segments" })}>
    <h2 className="text-title font-semibold">{i18n._({ id: "Detected breaks", message: "Detected breaks" })}</h2>
    {message ? <p role="status" className="text-body">{message}</p> : null}
    {segments.length ? <ol className="flex flex-col gap-3">{segments.map((segment) => <li key={segment.id} className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2"><strong>{segmentKindLabel(segment.kind)}</strong><Badge variant="secondary">{segmentStatusLabel(segment.status)}</Badge></div>
      <p className="text-body text-muted-foreground">{time(segment.start)}–{time(segment.end)} · {(() => { const label = skipSourceLabel(segment.source, segment.confidence); return i18n._({ id: label.id, message: label.id, ...("values" in label ? { values: label.values } : {}) }); })()}</p>
      <div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => session.controls.seekTo(segment.start)}>{i18n._({ id: "Play this range", message: "Play this range" })}</Button>{canReview && segment.status === "held" ? <Button type="button" onClick={() => correction.mutate({ segment_id: segment.id, rejected: false })} disabled={correction.isPending}>{i18n._({ id: "Confirm", message: "Confirm" })}</Button> : null}{canReview && segment.status !== "rejected" ? <Button type="button" variant="outline" onClick={() => correction.mutate({ segment_id: segment.id, rejected: true })} disabled={correction.isPending}>{i18n._({ id: "This was wrong", message: "This was wrong" })}</Button> : null}</div>
    </li>)}</ol> : <p className="text-body text-muted-foreground">{i18n._({ id: "No breaks were found in this episode.", message: "No breaks were found in this episode." })}</p>}
    {canReview ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { if (pendingRange) { missing.mutate(pendingRange); return; } const current = session.controls.currentTime(); if (markStart === null) { setMarkStart(current); setMessage(i18n._({ id: "Ad start marked. Listen to its end, then mark the end.", message: "Ad start marked. Listen to its end, then mark the end." })); } else saveMissingRange(current); }} disabled={missing.isPending}>{pendingRange ? i18n._({ id: "Retry missed-ad report", message: "Retry missed-ad report" }) : markStart === null ? i18n._({ id: "Missed an ad", message: "Missed an ad" }) : i18n._({ id: "Send marked range", message: "Send marked range" })}</Button>{markStart !== null ? <Button type="button" variant="outline" onClick={() => { setMarkStart(null); setMessage(i18n._({ id: "Marked range cleared.", message: "Marked range cleared." })); }}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button> : null}</div> : null}
  </section>;
}
