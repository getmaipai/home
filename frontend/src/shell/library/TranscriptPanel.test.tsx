import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Transcript } from "@maipai/spec/gen/ts/transcript.js";
import { transcriptApi } from "@/lib/transcriptApi";
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

function Harness({ me = person, initialTab }: { me?: Roster; initialTab?: string }) {
  const node = useTranscriptWorkspace({
    item,
    me,
    initialTab,
    currentTime: 0,
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
async function readyView(initialTab?: string) {
  stub(spyOn(transcriptApi, "start").mockResolvedValue(record));
  stubRevisions();
  const view = render(<Harness initialTab={initialTab} />);
  fireEvent.click(view.getByRole("button", { name: "Make transcript" }));
  await view.findByRole("tab", { name: "Search" });
  return view;
}

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
