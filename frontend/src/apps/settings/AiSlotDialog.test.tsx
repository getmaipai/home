import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AiSlotChoices } from "@/apps/settings/AiSlotDialog";
import { draftOf, type SlotDrafts } from "@/apps/settings/aiTierSlots";
import type { GlanceRow } from "@/apps/settings/aiGlanceRows";
import { Dialog, DialogContent } from "@maipai/ui/src/ui/dialog";

afterEach(cleanup);

const row = { job: "videos", title: "Video", options: [], recommended: null } as unknown as GlanceRow;
const initial = (): SlotDrafts => ({ reduced: draftOf(undefined, "reduced"), standard: draftOf(undefined, "standard"), boost: draftOf(undefined, "boost"), max: draftOf(undefined, "max") });
const open = (onSave: (d: SlotDrafts) => void) => render(<Dialog open><DialogContent><AiSlotChoices row={row} initial={initial()} copy={{}} saving={false} error={null} onClose={() => {}} onSave={onSave} /></DialogContent></Dialog>);

describe("AiSlotChoices", () => {
  test("Standard has no switch to turn off; Boost and Max do, and turning Max off saves it as off with the consequence shown first", () => {
    const save = mock((_: SlotDrafts) => {});
    const view = open(save);
    expect(view.getByRole("switch", { name: "Standard: On" }).hasAttribute("disabled")).toBe(true);
    expect(view.queryByRole("switch", { name: /simplify/i })).toBeNull();
    fireEvent.click(view.getByRole("switch", { name: "Max: On" }));
    expect(view.getByTestId("ai-slot-consequences").textContent).toContain("Max is off for video");
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    expect(save.mock.calls[0]![0].max.model).toBe("off");
    expect(save.mock.calls[0]![0].boost.model).toBe("recommended");
  });

  test("Max never offers everyone", () => {
    const view = open(() => {});
    const max = view.getByTestId("ai-slot-max");
    expect(max.textContent).toContain("Assigned people only");
    expect(max.textContent).not.toContain("Everyone the age gates allow");
  });
});
