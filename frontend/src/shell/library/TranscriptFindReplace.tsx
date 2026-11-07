import { i18n } from "@lingui/core";
// Find and replace on the Edit tab: preview the lines that would change, pick which, apply as one undoable change.
import { useState } from "react";
import type { Transcript } from "@maipai/spec/gen/ts/transcript.js";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { transcriptApi, type FindReplaceOptions, type FindReplacePreview } from "@/lib/transcriptApi";

const NEED_FIND = "Type the text to find, then press Preview.";
const PREVIEW_FAILED = "The matches could not be listed. Check that Home is ready, then try again.";
const APPLY_FAILED = "The replace did not go through. Check that Home is ready, then try again.";
const NOTHING = "Nothing to replace. No line has that text.";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function FindReplace({ transcript, onChange }: { transcript: Transcript; onChange: (next: Transcript) => void }) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [preview, setPreview] = useState<FindReplacePreview | null>(null);
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const options = (): FindReplaceOptions => ({ find, replace, match_case: matchCase, whole_word: wholeWord });
  const chosen = preview?.matches.filter((match) => !unchecked.has(match.segment_id)) ?? [];

  // Any change to the search invalidates the listed matches, so Apply never uses a stale list.
  const edited = (change: () => void) => {
    change();
    setPreview(null);
    setUnchecked(new Set());
    setMessage("");
  };

  const runPreview = async () => {
    if (!find) {
      setMessage(NEED_FIND);
      return;
    }
    setBusy(true);
    setMessage(i18n._({ id: "Working…", message: "Working…" }));
    try {
      const found = await transcriptApi.previewFindReplace(transcript.id, options());
      setPreview(found);
      setUnchecked(new Set());
      setMessage(found.total_lines === 0 ? NOTHING : `${found.total_matches} ${found.total_matches === 1 ? "match" : "matches"} on ${found.total_lines} ${found.total_lines === 1 ? "line" : "lines"}.`);
    } catch {
      setMessage(PREVIEW_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setMessage(i18n._({ id: "Working…", message: "Working…" }));
    try {
      const result = await transcriptApi.applyFindReplace(transcript.id, options(), chosen.map((match) => match.segment_id));
      onChange(result.transcript);
      setPreview(null);
      setMessage(
        result.replaced_lines === 0
          ? NOTHING
          : `Replaced on ${result.replaced_lines} ${result.replaced_lines === 1 ? "line" : "lines"}. Undo puts ${result.replaced_lines === 1 ? "it" : "them all"} back.`,
      );
    } catch {
      setMessage(APPLY_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (segmentId: string, on: boolean) =>
    setUnchecked((old) => {
      const next = new Set(old);
      if (on) next.delete(segmentId);
      else next.add(segmentId);
      return next;
    });

  return (
    <section aria-label={i18n._({ id: "Find and replace", message: "Find and replace" })} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{i18n._({ id: "Find and replace", message: "Find and replace" })}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <Input aria-label={i18n._({ id: "Find", message: "Find" })} placeholder={i18n._({ id: "Find", message: "Find" })} value={find} onChange={(event) => edited(() => setFind(event.target.value))} />
        <Input
          aria-label={i18n._({ id: "Replace with", message: "Replace with" })}
          placeholder={i18n._({ id: "Replace with", message: "Replace with" })}
          value={replace}
          onChange={(event) => edited(() => setReplace(event.target.value))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Checkbox id="find-match-case" checked={matchCase} onCheckedChange={(value) => edited(() => setMatchCase(value === true))} />
          <Label htmlFor="find-match-case">{i18n._({ id: "Match case", message: "Match case" })}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="find-whole-word" checked={wholeWord} onCheckedChange={(value) => edited(() => setWholeWord(value === true))} />
          <Label htmlFor="find-whole-word">{i18n._({ id: "Whole word", message: "Whole word" })}</Label>
        </div>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void runPreview()}>
          {i18n._({ id: "Preview", message: "Preview" })}</Button>
        <Button type="button" disabled={busy || chosen.length === 0} onClick={() => void apply()}>
          {i18n._({ id: "Apply", message: "Apply" })}</Button>
      </div>
      {preview && preview.matches.length > 0 ? (
        <ul aria-label={i18n._({ id: "Lines that would change", message: "Lines that would change" })} className="flex flex-col gap-2">
          {preview.matches.map((match) => (
            <li key={match.segment_id} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`find-line-${match.segment_id}`}
                aria-label={`Replace on line at ${clock(match.start)}`}
                checked={!unchecked.has(match.segment_id)}
                onCheckedChange={(value) => toggle(match.segment_id, value === true)}
              />
              <Label htmlFor={`find-line-${match.segment_id}`}>
                <span className="text-muted-foreground">{i18n._({ id: "{time} before: {text}", message: "{time} before: {text}", values: { time: clock(match.start), text: match.before } })}</span>{" "}
                <span>{i18n._({ id: "after: {text}", message: "after: {text}", values: { text: match.after } })}</span>
              </Label>
            </li>
          ))}
        </ul>
      ) : null}
      {preview?.more ? (
        <p className="text-sm text-muted-foreground">
          {i18n._({ id: "Showing the first {shown} of {total} lines. Apply replaces only the lines listed, so run it again for the rest.", message: "Showing the first {shown} of {total} lines. Apply replaces only the lines listed, so run it again for the rest.", values: { shown: preview.matches.length, total: preview.total_lines } })}</p>
      ) : null}
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    </section>
  );
}
