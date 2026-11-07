// The caption tracks of a transcript, on the Export tab: which are up to date and which need refreshing.
import { useEffect, useState } from "react";
import type { Transcript } from "@maipai/spec/gen/ts/transcript.js";
import { Button } from "@maipai/ui/src/ui/button";
import { transcriptApi, type CaptionTrackSummary } from "@/lib/transcriptApi";

const LOAD_FAILED = "Caption tracks could not be loaded. Check that Home is ready, then reopen this tab.";
const MAKE_FAILED = "The caption track could not be made. Check that Home is ready, then try again.";
const REFRESH_FAILED = "The caption track could not be refreshed. Check that Home is ready, then try again.";

// "und" is the transcript's own marker for a language nobody named; people see words, not codes.
const languageName = (code: string): string => (code === "und" ? "Unknown language" : code);

export function CaptionTracks({ transcript }: { transcript: Transcript }) {
  const [tracks, setTracks] = useState<CaptionTrackSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // A revision change (an edit, an undo) can make a track stale, so the list is read again each time.
  useEffect(() => {
    let current = true;
    transcriptApi
      .captionTracks(transcript.id)
      .then((found) => { if (current) setTracks(found); })
      .catch(() => { if (current) setMessage(LOAD_FAILED); });
    return () => { current = false; };
  }, [transcript.id, transcript.current_revision]);

  const run = async (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    setMessage("Working…");
    try {
      await work();
    } catch {
      setMessage(failure);
    } finally {
      setBusy(false);
    }
  };

  const make = () =>
    run(async () => {
      const made = await transcriptApi.makeCaptionTrack(transcript.id);
      setTracks((old) => [...old, made]);
      setMessage("Caption track made.");
    }, MAKE_FAILED);

  const refresh = (track: CaptionTrackSummary) =>
    run(async () => {
      const updated = await transcriptApi.refreshCaptionTrack(transcript.id, track.id);
      setTracks((old) => old.map((entry) => (entry.id === track.id ? updated : entry)));
      setMessage("Caption track refreshed. Captions you fixed by hand were kept.");
    }, REFRESH_FAILED);

  return (
    <section aria-label="Caption tracks" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Caption tracks</h3>
      {tracks.map((track) => (
        <div key={track.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{languageName(track.language)}</span>
          <span>{track.needs_refreshing ? "Needs refreshing" : "Up to date"}</span>
          {track.needs_refreshing ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`Refresh ${languageName(track.language)} captions`}
              disabled={busy}
              onClick={() => void refresh(track)}
            >
              Refresh
            </Button>
          ) : null}
        </div>
      ))}
      <div>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void make()}>
          Make caption track
        </Button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    </section>
  );
}
