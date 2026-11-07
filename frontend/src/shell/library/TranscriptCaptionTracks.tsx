// The caption tracks of a transcript, on the Export tab: which are up to date and which need refreshing.
import { useEffect, useState } from "react";
import type { Transcript } from "@maipai/spec/gen/ts/transcript.js";
import { Button } from "@maipai/ui/src/ui/button";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { transcriptApi, type CaptionTrackSummary } from "@/lib/transcriptApi";

const LOAD_FAILED = "Caption tracks could not be loaded. Check that Home is ready, then reopen this tab.";
const MAKE_FAILED = "The caption track could not be made. Check that Home is ready, then try again.";
const TRANSLATE_FAILED = "The captions could not be translated. Check that the language model is running, then try again.";
const REFRESH_FAILED = "The caption track could not be refreshed. Check that Home is ready, then try again.";

// "und" is the transcript's own marker for a language nobody named; people see words, not codes.
const languageName = (code: string, names: readonly { code: string; name: string }[] = []): string =>
  code === "und" ? "Unknown language" : (names.find((entry) => entry.code === code)?.name ?? code);

export function CaptionTracks({ transcript }: { transcript: Transcript }) {
  const [tracks, setTracks] = useState<CaptionTrackSummary[]>([]);
  const [languages, setLanguages] = useState<Array<{ code: string; name: string }>>([]);
  const [target, setTarget] = useState("es");
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

  useEffect(() => {
    let current = true;
    transcriptApi.translationLanguages().then((found) => { if (current) setLanguages(found); }).catch(() => undefined);
    return () => { current = false; };
  }, []);

  const original = tracks.find((track) => !track.translated);

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

  const translate = () =>
    run(async () => {
      if (!original) return;
      const made = await transcriptApi.translateCaptionTrack(transcript.id, original.id, target);
      setTracks((old) => [...old, made]);
      setMessage(`Translated to ${languageName(made.language, languages)}. It is its own track.`);
    }, TRANSLATE_FAILED);

  return (
    <section aria-label="Caption tracks" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Caption tracks</h3>
      {tracks.map((track) => (
        <div key={track.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{languageName(track.language, languages)}</span>
          <span>{track.translated ? "Translated" : track.needs_refreshing ? "Needs refreshing" : "Up to date"}</span>
          {(["srt", "vtt"] as const).map((format) => (
            <Button key={format} asChild variant="secondary" size="sm">
              <a
                href={transcriptApi.exportUrl(transcript.id, format, track.id)}
                download={`captions-${track.language}.${format}`}
                aria-label={`Download ${languageName(track.language, languages)} ${format.toUpperCase()}`}
              >
                {format.toUpperCase()}
              </a>
            </Button>
          ))}
          {track.needs_refreshing && !track.translated ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`Refresh ${languageName(track.language, languages)} captions`}
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
      {original && languages.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="translate-language">Translate captions to</Label>
            <Select value={target} onValueChange={(value) => setTarget(value ?? "es")}>
              <SelectTrigger id="translate-language"><SelectValue /></SelectTrigger>
              <SelectContent>
                {languages.filter((entry) => entry.code !== original.language).map((entry) => (
                  <SelectItem key={entry.code} value={entry.code}>{entry.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void translate()}>
            Translate
          </Button>
        </div>
      ) : null}
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    </section>
  );
}
