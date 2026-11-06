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
import { isAdultRole } from "./libraryModel";
import { addCaptionTrack } from "./viewerMedia";

const START_FAILED = "The transcript could not be made. Check that Home is ready, then try again.";
const SAVE_FAILED = "Could not save. Check Home and try again.";
const IMPORT_FAILED = "That file could not be read. Pick an SRT, VTT or text file and try again.";

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

function importFormatOf(fileName: string): ImportFormat | null {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "srt" || extension === "vtt" || extension === "txt") return extension;
  return null;
}

function linesOf(transcript: Transcript): TimedLyricLine[] {
  return transcript.segments.map((segment) => ({
    t: segment.start,
    line: segment.text,
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

  const save = async (segmentId: string) => {
    const segment = transcript.segments.find((entry) => entry.id === segmentId);
    const text = drafts[segmentId];
    if (!segment || text === undefined || text === segment.text) {
      setSaved(true);
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

  const renderLine = (line: TimedLyricLine, index: number, state: { active: boolean }): ReactNode => {
    const segment = transcript.segments[index];
    const segmentId = segment?.id ?? "";
    const name = `Edit line at ${timeLabel(line.t)}`;
    if (!state.active && selected !== segmentId) {
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
    );
  };

  return (
    <>
      <p role="status" className="text-sm text-muted-foreground">
        {failed ? SAVE_FAILED : saved ? "Saved" : "Saving…"}
      </p>
      <LyricsList
        lines={lines}
        currentTime={currentTime}
        onSeek={onSeek}
        labels={{ label: "Transcript lines" }}
        renderLine={renderLine}
      />
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
