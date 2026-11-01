import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Dialog, DialogContent } from "@maipai/ui/src/ui/dialog";
import { AiJobSummary, summarize } from "@/apps/settings/AiJobSummary";
import { draftOf, type SlotDrafts } from "@/apps/settings/aiTierSlots";
import type { GlanceRow } from "@/apps/settings/aiGlanceRows";

afterEach(cleanup);

const row = { job: "videos", title: "Video", options: [{ id: "video.ltx", label: "LTX 2.3" }], recommended: { label: "FastWan" }, shown: { label: "FastWan" }, shownEnabled: true, badge: "recommended" } as unknown as GlanceRow;
const drafts = (): SlotDrafts => ({ reduced: draftOf(undefined, "reduced"), standard: draftOf(undefined, "standard"), boost: draftOf(undefined, "boost"), max: draftOf(undefined, "max") });

describe("summarize", () => {
  test("Standard reads the chosen model; a picked Boost model is custom; a switched-off Max is off", () => {
    const d = drafts();
    d.boost = { ...d.boost, model: "video.ltx" };
    d.max = { ...d.max, model: "off" };
    const [standard, boost, max] = summarize(row, d, null);
    expect(standard).toMatchObject({ tier: "standard", model: "FastWan", kind: "recommended" });
    expect(boost).toMatchObject({ tier: "boost", model: "LTX 2.3", kind: "custom" });
    expect(max).toMatchObject({ tier: "max", model: "Off", kind: "off" });
  });

  test("chat lists Standard and the simplify level (nothing reads a chat Boost or Max pick), and simplify starts off", () => {
    const levels = summarize({ ...row, job: "chat" } as GlanceRow, drafts(), null);
    expect(levels.map((l) => l.tier)).toEqual(["standard", "reduced"]);
    expect(levels[1]).toMatchObject({ kind: "off" });
  });
});

describe("AiJobSummary", () => {
  test("every level is a row with an Edit button that names the level", () => {
    const edit = mock((_: string) => {});
    const view = render(<Dialog open><DialogContent><AiJobSummary row={row} drafts={drafts()} picks={null} copy={{}} onEdit={edit} onClose={() => {}} /></DialogContent></Dialog>);
    expect(view.getByTestId("ai-summary-boost").textContent).toContain("Recommended");
    fireEvent.click(view.getByRole("button", { name: "Edit Boost: Video" }));
    expect(edit.mock.calls[0]![0]).toBe("boost");
  });
});
