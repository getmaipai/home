// The Transcript panel of the Library viewer: make a transcript, search it, edit it and export it.
// Children never see it (the hub refuses them too).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Transcript } from "@maipai/spec/gen/ts/transcript.js";
import { LyricsList, type TimedLyricLine } from "@maipai/ui/src/elements/lyrics-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import type { LibraryItem, Roster } from "@/lib/api";
import { transcriptApi, type ImportFormat, type TranscriptFormat } from "@/lib/transcriptApi";
import { CaptionTracks } from "./TranscriptCaptionTracks";
import { FindReplace } from "./TranscriptFindReplace";
import { isAdultRole } from "./libraryModel";
import { addCaptionTrack } from "./viewerMedia";

const START_FAILED = "The transcript could not be made. Check that Home is ready, then try again.";
const SAVE_FAILED = "Could not save. Check Home and try again.";
const IMPORT_FAILED = "That file could not be read. Pick an SRT, VTT or text file and try again.";

const DETECT_FAILED = "Speakers could not be detected. Check that Home is ready, then try again.";
const REDO_FAILED = "That range could not be redone. Check the times and that Home is ready, then try again.";
const REDO_BAD_TIMES = "Enter the From and To times as minutes and seconds, like 1:05, with To after From.";

const DOWNLOADS: Array<[TranscriptFormat, string]> = [
  ["srt", "SRT"],
  ["vtt", "VTT"],
  ["txt", "Text"],
  ["md", "Markdown"],
  ["json", "JSON"],
];

export function timeLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${minutes}:${rest}`;
}

/** Seconds as m:ss, with tenths only when the time has them, so a prefilled range keeps its exact edges. */
function clockLabel(seconds: number): string {
  const whole = Math.floor(seconds);
  const tenths = Math.round((seconds - whole) * 10);
  return tenths > 0 ? `${timeLabel(whole)}.${tenths}` : timeLabel(whole);
}

/** "1:05", "1:05.5" or "65" to seconds; null when it is not a time. */
export function parseClock(text: string): number | null {
  const match = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2]);
}

const ALL_SPEAKERS = "all";
const SELECT_CLASS = "rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground";
const newSpeakerId = () => `spk-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;

function importFormatOf(fileName: string): ImportFormat | null {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "srt" || extension === "vtt" || extension === "txt") return extension;
  return null;
}

function linesOf(transcript: Transcript): TimedLyricLine[] {
  return transcript.segments.map((segment) => ({
    t: segment.start,
    line: segment.text,
    words: segment.words?.map((word) => ({ t: word.start, end: word.end, text: word.text })),
    speaker: transcript.speakers.find((speaker) => speaker.id === segment.speaker)?.label,
  }));
}

// Shows the hub's captions on the player while the transcript is open.
function useCaptionPreview(transcript: Transcript | null): void {
  useEffect(() => {
    if (!transcript) return;
    const controller = new AbortController();
    let url: string | null = null;
    let removeTrack = () => {};
    const request = fetch(transcriptApi.exportUrl(transcript.id, "vtt"), {
      credentials: "include",
      signal: controller.signal,
    });
    request
      .then(async (response) => {
        if (!response.ok) throw new Error("captions unavailable");
        url = URL.createObjectURL(await response.blob());
        removeTrack = addCaptionTrack(url, transcript.language, "Transcript");
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      removeTrack();
      if (url) URL.revokeObjectURL(url);
    };
  }, [transcript]);
}

function useRevisions(transcript: Transcript | null): Array<{ n: number }> {
  const [revisions, setRevisions] = useState<Array<{ n: number }>>([]);
  useEffect(() => {
    if (!transcript) return;
    transcriptApi
      .revisions(transcript.id)
      .then((rows) => setRevisions(rows.map(({ n }) => ({ n }))))
      .catch(() => setRevisions([]));
  }, [transcript]);
  return revisions;
}

function StartView({ busy, failed, onStart }: { busy: boolean; failed: boolean; onStart: () => void }) {
  return (
    <>
      <h2 className="text-lg font-semibold">Transcript</h2>
      <Button type="button" disabled={busy} onClick={onStart}>
        {busy ? "Making transcript…" : "Make transcript"}
      </Button>
      {failed ? (
        <p role="status" className="text-sm text-muted-foreground">
          {START_FAILED}
        </p>
      ) : null}
    </>
  );
}

type TabProps = { lines: TimedLyricLine[]; currentTime: number; onSeek: (time: number) => void };

function SearchTab({ lines, currentTime, onSeek }: TabProps) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const matches = lines
    .filter((line) => !query || line.line.toLocaleLowerCase().includes(query))
    .map((line) => ({ ...line, secondary: timeLabel(line.t) }));
  return (
    <>
      <Input
        aria-label="Search transcript"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search lines"
      />
      <LyricsList
        lines={matches}
        currentTime={currentTime}
        onSeek={onSeek}
        highlight={search.trim()}
        labels={{ label: "Matching transcript lines", empty: "No matching lines" }}
      />
    </>
  );
}

type EditTabProps = TabProps & {
  transcript: Transcript;
  revisions: Array<{ n: number }>;
  onChange: (next: Transcript) => void;
};

function EditTab({ transcript, lines, currentTime, onSeek, revisions, onChange }: EditTabProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState(ALL_SPEAKERS);
  const [newName, setNewName] = useState("");
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [rework, setRework] = useState<{ busy: boolean; message: string }>({ busy: false, message: "" });
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  // Picking a line prefills the range to redo with that line's edges.
  useEffect(() => {
    const segment = transcript.segments.find((entry) => entry.id === selected);
    if (!segment) return;
    setRangeFrom(clockLabel(segment.start));
    setRangeTo(clockLabel(segment.end));
  }, [selected, transcript.segments]);

  const runRework = async (run: () => Promise<string>, failure: string) => {
    setRework({ busy: true, message: "Working…" });
    try {
      setRework({ busy: false, message: await run() });
    } catch {
      setRework({ busy: false, message: failure });
    }
  };

  const detectSpeakers = () =>
    runRework(async () => {
      const result = await transcriptApi.detectSpeakers(transcript.id);
      if (result.diarization === "unavailable") {
        return result.note ?? DETECT_FAILED;
      }
      onChange(result.transcript);
      return "Speakers detected. Undo puts the lines back.";
    }, DETECT_FAILED);

  const redoRange = () => {
    const from = parseClock(rangeFrom);
    const to = parseClock(rangeTo);
    if (from === null || to === null || to <= from) {
      setRework({ busy: false, message: REDO_BAD_TIMES });
      return Promise.resolve();
    }
    return runRework(async () => {
      onChange(await transcriptApi.regenerateRange(transcript.id, from, to));
      return "Range redone. Undo puts the lines back.";
    }, REDO_FAILED);
  };

  // Visible lines keep their segment index, so seeks and edits always hit the right segment.
  const visible = useMemo(
    () => lines.map((_, index) => index).filter((index) => filter === ALL_SPEAKERS || transcript.segments[index]?.speaker === filter),
    [lines, transcript.segments, filter],
  );
  const shownLines = useMemo(() => visible.map((index) => lines[index]!), [visible, lines]);

  const save = async (segmentId: string) => {
    const segment = transcript.segments.find((entry) => entry.id === segmentId);
    const text = drafts[segmentId];
    if (!segment || text === undefined || text === segment.text) {
      setSaved(true);
      setSelected(null);
      return;
    }
    setSaved(false);
    setFailed(false);
    try {
      onChange(await transcriptApi.edit(transcript.id, [{ kind: "replace_text", segment_id: segmentId, text }]));
      setDrafts(({ [segmentId]: _done, ...rest }) => rest);
      setSelected(null);
      setSaved(true);
    } catch {
      setFailed(true);
    }
  };

  const change = async (run: () => Promise<Transcript>) => {
    try {
      onChange(await run());
      setSaved(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  const pick = (segmentId: string | undefined, time: number) => {
    onSeek(time);
    setSelected(segmentId ?? null);
  };

  const assignSpeaker = (segmentId: string, speaker: string) =>
    change(() => transcriptApi.edit(transcript.id, [{ kind: "set_speaker", segment_id: segmentId, speaker }]));

  const addSpeaker = async () => {
    const label = newName.trim();
    if (!label) return;
    await change(() => transcriptApi.edit(transcript.id, [{ kind: "add_speaker", speaker_id: newSpeakerId(), label }]));
    setNewName("");
  };

  const renderLine = (line: TimedLyricLine, visibleIndex: number, state: { active: boolean }): ReactNode => {
    const index = visible[visibleIndex] ?? visibleIndex;
    const segment = transcript.segments[index];
    const segmentId = segment?.id ?? "";
    const name = `Edit line at ${timeLabel(line.t)}`;
    const words = line.words ?? [];
    if (words.length > 0 && selected !== segmentId) {
      return (
        <span className="flex flex-wrap items-baseline gap-x-1">
          {words.map((word, wordIndex) => {
            const current = currentTime >= word.t && currentTime < word.end;
            return (
              <button
                key={`${wordIndex}-${word.t}`}
                type="button"
                aria-current={current ? "true" : undefined}
                className={current ? "font-semibold text-foreground" : "text-muted-foreground"}
                onClick={() => onSeek(word.t)}
              >
                {word.text.trim()}
              </button>
            );
          })}
          <Button type="button" variant="ghost" size="sm" aria-label={name} onClick={() => pick(segment?.id, line.t)}>
            Edit
          </Button>
        </span>
      );
    }
    if (words.length === 0 && !state.active && selected !== segmentId) {
      return (
        <span
          role="button"
          tabIndex={0}
          aria-label={name}
          onClick={() => pick(segment?.id, line.t)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            pick(segment?.id, line.t);
          }}
        >
          {line.line}
        </span>
      );
    }
    return (
      <span className="flex w-full flex-col gap-2">
        <Textarea
          aria-label={name}
          value={drafts[segmentId] ?? line.line}
          onChange={(event) => {
            setDrafts((old) => ({ ...old, [segmentId]: event.target.value }));
            setSaved(false);
          }}
          onBlur={() => void save(segmentId)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            event.currentTarget.blur();
          }}
        />
        {transcript.speakers.length > 0 ? (
          <select
            aria-label={`Speaker for line at ${timeLabel(line.t)}`}
            className={SELECT_CLASS}
            value={segment?.speaker ?? ""}
            onChange={(event) => void assignSpeaker(segmentId, event.target.value)}
          >
            <option value="" disabled>
              Choose a speaker
            </option>
            {transcript.speakers.map((speaker) => (
              <option key={speaker.id} value={speaker.id}>
                {speaker.label}
              </option>
            ))}
          </select>
        ) : null}
      </span>
    );
  };

  return (
    <>
      <p role="status" className="text-sm text-muted-foreground">
        {failed ? SAVE_FAILED : saved ? "Saved" : "Saving…"}
      </p>
      {transcript.speakers.length > 0 ? (
        <select
          aria-label="Filter by speaker"
          className={SELECT_CLASS}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value={ALL_SPEAKERS}>All speakers</option>
          {transcript.speakers.map((speaker) => (
            <option key={speaker.id} value={speaker.id}>
              {speaker.label}
            </option>
          ))}
        </select>
      ) : null}
      <LyricsList
        lines={shownLines}
        currentTime={currentTime}
        onSeek={onSeek}
        labels={{ label: "Transcript lines", empty: "No lines for this speaker" }}
        renderLine={renderLine}
      />
      <FindReplace transcript={transcript} onChange={onChange} />
      <section aria-label="Speakers" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Speakers</h3>
        {transcript.speakers.map((speaker) => {
          const draft = renames[speaker.id] ?? speaker.label;
          return (
            <div key={speaker.id} className="flex gap-2">
              <Input
                aria-label={`Name for ${speaker.label}`}
                value={draft}
                onChange={(event) => setRenames((old) => ({ ...old, [speaker.id]: event.target.value }))}
              />
              <Button
                type="button"
                variant="secondary"
                aria-label={`Rename ${speaker.label}`}
                disabled={!draft.trim() || draft.trim() === speaker.label}
                onClick={() =>
                  void change(() =>
                    transcriptApi.edit(transcript.id, [{ kind: "rename_speaker", speaker_id: speaker.id, label: draft.trim() }]),
                  )
                }
              >
                Rename
              </Button>
            </div>
          );
        })}
        <div className="flex gap-2">
          <Input
            aria-label="New speaker name"
            value={newName}
            placeholder="Speaker name"
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button type="button" variant="secondary" disabled={!newName.trim()} onClick={() => void addSpeaker()}>
            Add speaker
          </Button>
        </div>
      </section>
      <section aria-label="Redo with the speech engine" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Redo with the speech engine</h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={rework.busy} onClick={() => void detectSpeakers()}>
            Detect speakers
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input aria-label="From" placeholder="From 0:00" value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} />
          <Input aria-label="To" placeholder="To 0:30" value={rangeTo} onChange={(event) => setRangeTo(event.target.value)} />
          <Button type="button" variant="secondary" disabled={rework.busy || !rangeFrom.trim() || !rangeTo.trim()} onClick={() => void redoRange()}>
            Redo
          </Button>
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {rework.message}
        </p>
      </section>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void change(() => transcriptApi.undo(transcript.id))}>
          Undo
        </Button>
        {revisions.map((revision) => (
          <Button
            key={revision.n}
            type="button"
            variant="secondary"
            aria-label={`Restore revision ${revision.n}`}
            onClick={() => void change(() => transcriptApi.restore(transcript.id, revision.n))}
          >
            Restore {revision.n}
          </Button>
        ))}
      </div>
    </>
  );
}

function ExportTab({ transcript, item, onChange }: { transcript: Transcript; item: LibraryItem; onChange: (next: Transcript) => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const importFile = async (file: File) => {
    const format = importFormatOf(file.name);
    if (!format) {
      setFailed(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      onChange(await transcriptApi.import(item.id, format, await file.text()));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {DOWNLOADS.map(([format, label]) => (
          <Button key={format} asChild variant="secondary">
            <a href={transcriptApi.exportUrl(transcript.id, format)} download={`transcript.${format}`}>
              Download {label}
            </a>
          </Button>
        ))}
      </div>
      <CaptionTracks transcript={transcript} />
      <label className="flex flex-col gap-2 text-sm">
        Import SRT, VTT or text
        <input
          aria-label="Import transcript file"
          type="file"
          accept=".srt,.vtt,.txt"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void importFile(file);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {failed ? (
        <p role="status" className="text-sm text-muted-foreground">
          {IMPORT_FAILED}
        </p>
      ) : null}
    </>
  );
}

type WorkspaceOptions = {
  item: LibraryItem | undefined;
  me: Roster;
  onSeek: (time: number) => void;
  currentTime: number;
  initialTab?: string;
};

export function useTranscriptWorkspace({ item, me, onSeek, currentTime, initialTab = "search" }: WorkspaceOptions): ReactNode {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState(initialTab);
  const itemId = item?.id;
  useEffect(() => {
    // A different file has its own transcript; load the one this file already has.
    setTranscript(null);
    setFailed(false);
    if (!itemId) return;
    let current = true;
    transcriptApi
      .forItem(itemId)
      .then((found) => { if (current) setTranscript(found); })
      .catch(() => { /* No transcript to show; the Make transcript button still works. */ });
    return () => { current = false; };
  }, [itemId]);
  useCaptionPreview(transcript);
  const revisions = useRevisions(transcript);
  const lines = useMemo(() => (transcript ? linesOf(transcript) : []), [transcript]);

  const offered = item !== undefined && (isAdultRole(me) || me.age_band === "teen");
  if (!offered) return null;

  const start = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setTranscript(await transcriptApi.start(item.id));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!transcript) return <StartView busy={busy} failed={failed} onStart={() => void start()} />;

  const shared = { lines, currentTime, onSeek };
  return (
    <>
      <h2 className="text-lg font-semibold">Transcript</h2>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Transcript tools">
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>
        <TabsContent value="search">
          <SearchTab {...shared} />
        </TabsContent>
        <TabsContent value="edit">
          <EditTab {...shared} transcript={transcript} revisions={revisions} onChange={setTranscript} />
        </TabsContent>
        <TabsContent value="export">
          <ExportTab transcript={transcript} item={item} onChange={setTranscript} />
        </TabsContent>
      </Tabs>
    </>
  );
}
