import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Transcript } from "@maipai/spec/gen/ts/transcript.js";
import { transcriptApi, type DetectSpeakersResult } from "@/lib/transcriptApi";
import type { LibraryItem, Roster } from "@/lib/api";
import { useTranscriptWorkspace } from "./TranscriptPanel";

const person = { id: "adult", role: "adult", age_band: "adult" } as Roster;
const child = { id: "child", role: "child", age_band: "child" } as Roster;
const item = { id: "file-1", kind: "audio", name: "Audio", owner: { id: "adult" } } as LibraryItem;
const record = {
  id: "tx-1",
  source: "file-1",
  language: "en",
  current_revision: 1,
  segments: [
    { id: "seg-1", start: 0, end: 2, text: "Hello world" },
    { id: "seg-2", start: 3, end: 5, text: "Goodbye world" },
  ],
  speakers: [],
  vocabulary: [],
  provenance: { engine: "local", model_id: "test", source_kind: "generated" },
  clock: { created_at: "2026-11-06T00:00:00Z", updated_at: "2026-11-06T00:00:00Z", hlc: "1:1:abcdef" },
} as Transcript;

function Harness({ me = person, initialTab, currentTime = 0 }: { me?: Roster; initialTab?: string; currentTime?: number }) {
  const node = useTranscriptWorkspace({
    item,
    me,
    initialTab,
    currentTime,
    onSeek: (time) => {
      document.body.dataset.seek = String(time);
    },
  });
  return <>{node}</>;
}

const spies: Array<{ mockRestore: () => void }> = [];
function stub<T extends { mockRestore: () => void }>(spy: T): T {
  spies.push(spy);
  return spy;
}
function stubRevisions() {
  return stub(spyOn(transcriptApi, "revisions").mockResolvedValue([]));
}
async function readyView(initialTab?: string, transcript: Transcript = record, currentTime = 0) {
  stub(spyOn(transcriptApi, "start").mockResolvedValue(transcript));
  stubRevisions();
  const view = render(<Harness initialTab={initialTab} currentTime={currentTime} />);
  fireEvent.click(view.getByRole("button", { name: "Make transcript" }));
  await view.findByRole("tab", { name: "Search" });
  return view;
}

// The panel asks the hub whether the file already has a transcript; no test may reach a real hub.
beforeEach(() => {
  stub(spyOn(transcriptApi, "forItem").mockResolvedValue(null));
  stub(spyOn(transcriptApi, "captionTracks").mockResolvedValue([]));
});

afterEach(() => {
  cleanup();
  while (spies.length) spies.pop()!.mockRestore();
  delete document.body.dataset.seek;
});

describe("Library transcript workspace states", () => {
  test("none: offers one Make transcript button", () => {
    const view = render(<Harness />);
    expect(view.getByRole("button", { name: "Make transcript" })).toBeTruthy();
    expect(view.queryByRole("tab", { name: "Search" })).toBeNull();
  });

  test("generating: the button is disabled and says so until the hub answers", async () => {
    let finish: (value: Transcript) => void = () => {};
    stub(spyOn(transcriptApi, "start").mockReturnValue(new Promise<Transcript>((resolve) => (finish = resolve))));
    stubRevisions();
    const view = render(<Harness />);
    fireEvent.click(view.getByRole("button", { name: "Make transcript" }));
    const working = await view.findByRole("button", { name: "Making transcript…" });
    expect((working as HTMLButtonElement).disabled).toBe(true);
    finish(record);
    expect(await view.findByRole("tab", { name: "Search" })).toBeTruthy();
  });

  test("ready: shows the lines and the three tabs", async () => {
    const view = await readyView();
    expect(view.getByRole("tab", { name: "Edit" })).toBeTruthy();
    expect(view.getByRole("tab", { name: "Export" })).toBeTruthy();
    expect(view.getByText("Goodbye world")).toBeTruthy();
  });

  test("failed: plain line, no raw error, and the button comes back", async () => {
    stub(spyOn(transcriptApi, "start").mockRejectedValue(new Error("private raw detail")));
    const view = render(<Harness />);
    fireEvent.click(view.getByRole("button", { name: "Make transcript" }));
    const status = await view.findByRole("status");
    expect(status.textContent).toBe("The transcript could not be made. Check that Home is ready, then try again.");
    expect(view.container.textContent).not.toContain("private raw detail");
    expect((view.getByRole("button", { name: "Make transcript" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Library transcript workspace: an existing transcript", () => {
  test("shows the transcript the file already has, with no Make transcript button, and never starts a second one", async () => {
    stubRevisions();
    const start = stub(spyOn(transcriptApi, "start"));
    stub(spyOn(transcriptApi, "forItem").mockResolvedValue(record));
    const view = render(<Harness />);
    expect(await view.findByRole("tab", { name: "Search" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Make transcript" })).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });
});

describe("Library transcript workspace tools", () => {
  test("clicking a line seeks to its start", async () => {
    const view = await readyView();
    fireEvent.click(view.getByText("Goodbye world"));
    expect(document.body.dataset.seek).toBe("3");
  });

  test("search filters lines and highlights the match", async () => {
    const view = await readyView();
    fireEvent.change(view.getByRole("textbox", { name: "Search transcript" }), { target: { value: "goodbye" } });
    expect(view.queryByText("Hello world")).toBeNull();
    expect(view.container.querySelector("mark")?.textContent?.toLocaleLowerCase()).toBe("goodbye");
  });

  test("edit saves exactly one PATCH on blur", async () => {
    const edit = stub(
      spyOn(transcriptApi, "edit").mockResolvedValue({
        ...record,
        current_revision: 2,
        segments: [record.segments[0]!, { ...record.segments[1]!, text: "Hi world" }],
      }),
    );
    const view = await readyView("edit");
    fireEvent.click(view.getByRole("button", { name: "Edit line at 0:03" }));
    const editor = await view.findByRole("textbox", { name: "Edit line at 0:03" });
    fireEvent.change(editor, { target: { value: "Hi world" } });
    fireEvent.blur(editor);
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(edit).toHaveBeenCalledWith("tx-1", [{ kind: "replace_text", segment_id: "seg-2", text: "Hi world" }]);
    expect((await view.findAllByText("Saved")).length).toBeGreaterThan(0);
  });

  test("a failed save says what to do and does not show the raw error", async () => {
    stub(spyOn(transcriptApi, "edit").mockRejectedValue(new Error("db locked")));
    const view = await readyView("edit");
    fireEvent.click(view.getByRole("button", { name: "Edit line at 0:03" }));
    const editor = await view.findByRole("textbox", { name: "Edit line at 0:03" });
    fireEvent.change(editor, { target: { value: "Hi" } });
    fireEvent.blur(editor);
    expect(await view.findByText("Could not save. Check Home and try again.")).toBeTruthy();
    expect(view.container.textContent).not.toContain("db locked");
  });

  test("export offers all five downloads from the export route", async () => {
    const view = await readyView("export");
    for (const [label, format] of [["SRT", "srt"], ["VTT", "vtt"], ["Text", "txt"], ["Markdown", "md"], ["JSON", "json"]]) {
      const link = view.getByRole("link", { name: `Download ${label}` });
      expect(link.getAttribute("href")).toBe(`/api/transcripts/tx-1/export?format=${format}`);
    }
    expect(view.getByLabelText("Import transcript file")).toBeTruthy();
  });

  test("a child sees nothing and the hub is not called", () => {
    const start = stub(spyOn(transcriptApi, "start"));
    const view = render(<Harness me={child} />);
    expect(view.container.textContent).toBe("");
    expect(start).not.toHaveBeenCalled();
  });
});

const spoken = {
  ...record,
  segments: [
    {
      id: "seg-1", start: 0, end: 2, text: "Hello world", speaker: "spk-aaa111",
      words: [{ start: 0, end: 1, text: "Hello" }, { start: 1, end: 2, text: "world" }],
    },
    { id: "seg-2", start: 3, end: 5, text: "Goodbye world", speaker: "spk-bbb222" },
  ],
  speakers: [{ id: "spk-aaa111", label: "Sage" }, { id: "spk-bbb222", label: "Nova" }],
} as Transcript;

describe("Library transcript workspace: words and speakers", () => {
  test("the word being spoken is marked current and a click seeks to that word", async () => {
    const view = await readyView("edit", spoken, 1.2);
    const world = view.getByRole("button", { name: "world" });
    expect(world.getAttribute("aria-current")).toBe("true");
    expect(view.getByRole("button", { name: "Hello" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Hello" }));
    expect(document.body.dataset.seek).toBe("0");
    fireEvent.click(world);
    expect(document.body.dataset.seek).toBe("1");
  });

  test("a selected line with words shows the editor and a speaker choice that calls set_speaker", async () => {
    const edit = stub(spyOn(transcriptApi, "edit").mockResolvedValue(spoken));
    const view = await readyView("edit", spoken, 4);
    fireEvent.click(view.getByRole("button", { name: "Edit line at 0:00" }));
    expect(await view.findByRole("textbox", { name: "Edit line at 0:00" })).toBeTruthy();
    fireEvent.change(view.getByLabelText("Speaker for line at 0:00"), { target: { value: "spk-bbb222" } });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(edit).toHaveBeenCalledWith("tx-1", [{ kind: "set_speaker", segment_id: "seg-1", speaker: "spk-bbb222" }]);
  });

  test("add and rename speaker send the speaker ops", async () => {
    const edit = stub(spyOn(transcriptApi, "edit").mockResolvedValue(spoken));
    const view = await readyView("edit", spoken);
    fireEvent.change(view.getByLabelText("New speaker name"), { target: { value: "Iris" } });
    fireEvent.click(view.getByRole("button", { name: "Add speaker" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    const added = edit.mock.calls[0]![1][0]!;
    expect(added).toMatchObject({ kind: "add_speaker", label: "Iris" });
    expect((added as { speaker_id: string }).speaker_id).toMatch(/^spk-[a-z0-9]{6}$/);
    fireEvent.change(view.getByLabelText("Name for Sage"), { target: { value: "Jesse" } });
    fireEvent.click(view.getByRole("button", { name: "Rename Sage" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(edit.mock.calls[1]![1]).toEqual([{ kind: "rename_speaker", speaker_id: "spk-aaa111", label: "Jesse" }]);
  });

  test("the speaker filter hides other speakers' lines and edits still hit the right segment", async () => {
    const edit = stub(spyOn(transcriptApi, "edit").mockResolvedValue(spoken));
    const view = await readyView("edit", spoken, 4);
    fireEvent.change(view.getByLabelText("Filter by speaker"), { target: { value: "spk-aaa111" } });
    expect(view.queryByText("Goodbye world")).toBeNull();
    expect(view.queryByRole("textbox", { name: "Edit line at 0:03" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Edit line at 0:00" }));
    const editor = await view.findByRole("textbox", { name: "Edit line at 0:00" });
    fireEvent.change(editor, { target: { value: "Hi world" } });
    fireEvent.blur(editor);
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(edit).toHaveBeenCalledWith("tx-1", [{ kind: "replace_text", segment_id: "seg-1", text: "Hi world" }]);
    fireEvent.change(view.getByLabelText("Filter by speaker"), { target: { value: "all" } });
    expect(view.getByText("Goodbye world")).toBeTruthy();
  });
});

describe("detect speakers and redo a range", () => {
  test("Detect speakers is disabled while it runs, then shows the result and refreshes the transcript", async () => {
    let finish: (value: DetectSpeakersResult) => void = () => {};
    const detect = stub(spyOn(transcriptApi, "detectSpeakers").mockReturnValue(new Promise<DetectSpeakersResult>((resolve) => (finish = resolve))));
    const view = await readyView("edit", spoken);
    fireEvent.click(view.getByRole("button", { name: "Detect speakers" }));
    await waitFor(() => expect(detect).toHaveBeenCalledWith("tx-1"));
    expect((view.getByRole("button", { name: "Detect speakers" }) as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText("Working…")).toBeTruthy();
    finish({ transcript: { ...spoken, language: "fr" } as Transcript, diarization: "done", note: null });
    expect(await view.findByText("Speakers detected. Undo puts the lines back.")).toBeTruthy();
    expect((view.getByRole("button", { name: "Detect speakers" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("when detection is unavailable the Stack's note is shown and the transcript is not replaced", async () => {
    stub(spyOn(transcriptApi, "detectSpeakers").mockResolvedValue({
      transcript: record,
      diarization: "unavailable",
      note: "Speaker detection needs its models. Install them in Stack and try again.",
    }));
    const view = await readyView("edit", spoken);
    fireEvent.click(view.getByRole("button", { name: "Detect speakers" }));
    expect(await view.findByText("Speaker detection needs its models. Install them in Stack and try again.")).toBeTruthy();
    // still the spoken transcript, with its speaker filter
    expect(view.getByLabelText("Filter by speaker")).toBeTruthy();
  });

  test("a failed detection says what to do", async () => {
    stub(spyOn(transcriptApi, "detectSpeakers").mockRejectedValue(new Error("x")));
    const view = await readyView("edit", spoken);
    fireEvent.click(view.getByRole("button", { name: "Detect speakers" }));
    expect(await view.findByText(/Speakers could not be detected\. Check that Home is ready/)).toBeTruthy();
  });

  test("Redo prefills From and To from the picked line and sends those seconds", async () => {
    const redo = stub(spyOn(transcriptApi, "regenerateRange").mockResolvedValue(record));
    const view = await readyView("edit", record, 0);
    fireEvent.click(view.getByRole("button", { name: "Edit line at 0:03" }));
    await waitFor(() => expect((view.getByLabelText("From") as HTMLInputElement).value).toBe("0:03"));
    expect((view.getByLabelText("To") as HTMLInputElement).value).toBe("0:05");
    fireEvent.change(view.getByLabelText("To"), { target: { value: "0:06.5" } });
    fireEvent.click(view.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(redo).toHaveBeenCalledWith("tx-1", 3, 6.5));
    expect(await view.findByText("Range redone. Undo puts the lines back.")).toBeTruthy();
  });

  test("bad times are explained and nothing is sent; a failed redo says what to do", async () => {
    const redo = stub(spyOn(transcriptApi, "regenerateRange").mockRejectedValue(new Error("x")));
    const view = await readyView("edit", record);
    fireEvent.change(view.getByLabelText("From"), { target: { value: "0:09" } });
    fireEvent.change(view.getByLabelText("To"), { target: { value: "0:04" } });
    fireEvent.click(view.getByRole("button", { name: "Redo" }));
    expect(await view.findByText(/Enter the From and To times/)).toBeTruthy();
    expect(redo).not.toHaveBeenCalled();
    fireEvent.change(view.getByLabelText("To"), { target: { value: "0:12" } });
    fireEvent.click(view.getByRole("button", { name: "Redo" }));
    expect(await view.findByText(/That range could not be redone\. Check the times/)).toBeTruthy();
  });
});

describe("Library transcript workspace: caption tracks needing a refresh", () => {
  const track = { id: "cap-1", language: "en", based_on_revision: 1, needs_refreshing: true, cue_count: 2, translated: false };

  test("a stale track says Needs refreshing; Refresh runs once, is disabled meanwhile, then it is Up to date", async () => {
    stub(spyOn(transcriptApi, "captionTracks").mockResolvedValue([track]));
    let finish: (value: typeof track) => void = () => {};
    const refresh = stub(
      spyOn(transcriptApi, "refreshCaptionTrack").mockReturnValue(new Promise<typeof track>((resolve) => (finish = resolve))),
    );
    const view = await readyView("export");
    expect(await view.findByText("Needs refreshing")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Refresh en captions" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Refresh en captions" }).hasAttribute("disabled")).toBe(true));
    expect(refresh).toHaveBeenCalledWith("tx-1", "cap-1");
    finish({ ...track, based_on_revision: 2, needs_refreshing: false });
    expect(await view.findByText("Up to date")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Refresh en captions" })).toBeNull();
    expect(view.getAllByRole("status").some((node) => node.textContent?.startsWith("Caption track refreshed"))).toBe(true);
  });

  test("a fresh track says Up to date and offers no Refresh button", async () => {
    stub(spyOn(transcriptApi, "captionTracks").mockResolvedValue([{ ...track, needs_refreshing: false }]));
    const view = await readyView("export");
    expect(await view.findByText("Up to date")).toBeTruthy();
    expect(view.queryByRole("button", { name: /Refresh/ })).toBeNull();
  });

  test("a failed refresh says what to do", async () => {
    stub(spyOn(transcriptApi, "captionTracks").mockResolvedValue([track]));
    stub(spyOn(transcriptApi, "refreshCaptionTrack").mockRejectedValue(new Error("private raw detail")));
    const view = await readyView("export");
    fireEvent.click(await view.findByRole("button", { name: "Refresh en captions" }));
    await waitFor(() => expect(view.container.textContent).toContain("The caption track could not be refreshed. Check that Home is ready, then try again."));
    expect(view.container.textContent).not.toContain("private raw detail");
  });
});

describe("Library transcript workspace: translated captions", () => {
  const original = { id: "cap-1", language: "en", based_on_revision: 1, needs_refreshing: false, cue_count: 2, translated: false };

  test("Translate makes a separate track in the chosen language and labels it Translated", async () => {
    stub(spyOn(transcriptApi, "captionTracks").mockResolvedValue([original]));
    stub(spyOn(transcriptApi, "translationLanguages").mockResolvedValue([{ code: "en", name: "English" }, { code: "es", name: "Spanish" }]));
    const translate = stub(
      spyOn(transcriptApi, "translateCaptionTrack").mockResolvedValue({ ...original, id: "cap-2", language: "es", translated: true }),
    );
    const view = await readyView("export");
    fireEvent.click(await view.findByRole("button", { name: "Translate" }));
    expect(await view.findByText("Translated")).toBeTruthy();
    expect(translate).toHaveBeenCalledWith("tx-1", "cap-1", "es");
    expect(view.getAllByRole("status").some((node) => node.textContent?.startsWith("Translated to Spanish"))).toBe(true);
    expect(view.queryByRole("button", { name: /Refresh Spanish/ })).toBeNull();
  });

  test("a failed translation says what to do and shows no raw detail", async () => {
    stub(spyOn(transcriptApi, "captionTracks").mockResolvedValue([original]));
    stub(spyOn(transcriptApi, "translationLanguages").mockResolvedValue([{ code: "es", name: "Spanish" }]));
    stub(spyOn(transcriptApi, "translateCaptionTrack").mockRejectedValue(new Error("private raw detail")));
    const view = await readyView("export");
    fireEvent.click(await view.findByRole("button", { name: "Translate" }));
    await waitFor(() => expect(view.container.textContent).toContain("The captions could not be translated. Check that the language model is running, then try again."));
    expect(view.container.textContent).not.toContain("private raw detail");
  });
});

describe("Library transcript workspace: find and replace", () => {
  const preview = {
    matches: [
      { segment_id: "seg-1", start: 0, before: "Hello world", after: "Hello planet", count: 1 },
      { segment_id: "seg-2", start: 3, before: "Goodbye world", after: "Goodbye planet", count: 1 },
    ],
    total_lines: 2,
    total_matches: 2,
    more: false,
  };
  const wanted = { find: "world", replace: "planet", match_case: false, whole_word: false };

  async function previewed() {
    const previewCall = stub(spyOn(transcriptApi, "previewFindReplace").mockResolvedValue(preview));
    const view = await readyView("edit");
    fireEvent.change(view.getByRole("textbox", { name: "Find" }), { target: { value: "world" } });
    fireEvent.change(view.getByRole("textbox", { name: "Replace with" }), { target: { value: "planet" } });
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    await view.findByText("after: Hello planet");
    return { view, previewCall };
  }

  test("Preview lists before and after for each line, with every line ticked, and changes nothing", async () => {
    const edit = stub(spyOn(transcriptApi, "edit"));
    const { view, previewCall } = await previewed();
    expect(previewCall).toHaveBeenCalledWith("tx-1", wanted);
    expect(view.getByText("after: Goodbye planet")).toBeTruthy();
    expect(view.getByRole("checkbox", { name: "Replace on line at 0:03" }).getAttribute("aria-checked")).toBe("true");
    expect(view.getAllByRole("status").some((node) => node.textContent === "2 matches on 2 lines.")).toBe(true);
    expect(edit).not.toHaveBeenCalled();
  });

  test("Apply sends only the ticked lines, shows the new transcript and says Undo reverts it", async () => {
    const changed = {
      ...record,
      current_revision: 2,
      segments: [{ ...record.segments[0]!, text: "Hello planet" }, record.segments[1]!],
    } as Transcript;
    const apply = stub(
      spyOn(transcriptApi, "applyFindReplace").mockResolvedValue({ transcript: changed, replaced_lines: 1, replaced_matches: 1 }),
    );
    const { view } = await previewed();
    fireEvent.click(view.getByRole("checkbox", { name: "Replace on line at 0:03" }));
    fireEvent.click(view.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("tx-1", wanted, ["seg-1"]));
    expect(await view.findByText("Replaced on 1 line. Undo puts it back.")).toBeTruthy();
    expect(view.getByText("Hello planet")).toBeTruthy();
  });

  test("the match case and whole word boxes reach the preview request", async () => {
    const previewCall = stub(spyOn(transcriptApi, "previewFindReplace").mockResolvedValue(preview));
    const view = await readyView("edit");
    fireEvent.change(view.getByRole("textbox", { name: "Find" }), { target: { value: "world" } });
    fireEvent.click(view.getByRole("checkbox", { name: "Match case" }));
    fireEvent.click(view.getByRole("checkbox", { name: "Whole word" }));
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(previewCall).toHaveBeenCalledWith("tx-1", { find: "world", replace: "", match_case: true, whole_word: true }));
  });

  test("nothing to replace says so, and an empty find asks for text without calling the hub", async () => {
    const previewCall = stub(
      spyOn(transcriptApi, "previewFindReplace").mockResolvedValue({ matches: [], total_lines: 0, total_matches: 0, more: false }),
    );
    const view = await readyView("edit");
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    expect(await view.findByText("Type the text to find, then press Preview.")).toBeTruthy();
    expect(previewCall).not.toHaveBeenCalled();
    fireEvent.change(view.getByRole("textbox", { name: "Find" }), { target: { value: "zebra" } });
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    expect(await view.findByText("Nothing to replace. No line has that text.")).toBeTruthy();
    expect((view.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("a failed preview says what to do and shows no raw error", async () => {
    stub(spyOn(transcriptApi, "previewFindReplace").mockRejectedValue(new Error("private raw detail")));
    const view = await readyView("edit");
    fireEvent.change(view.getByRole("textbox", { name: "Find" }), { target: { value: "world" } });
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    expect(await view.findByText("The matches could not be listed. Check that Home is ready, then try again.")).toBeTruthy();
    expect(view.container.textContent).not.toContain("private raw detail");
  });
});
