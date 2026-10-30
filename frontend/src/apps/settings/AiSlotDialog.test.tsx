import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AiSlotChoices } from "@/apps/settings/AiSlotDialog";
import { draftOf, type SlotDrafts } from "@/apps/settings/aiTierSlots";
import type { GlanceRow } from "@/apps/settings/aiGlanceRows";
import type { TierPicks } from "@/lib/aiChoicesApi";
import { Dialog, DialogContent } from "@maipai/ui/src/ui/dialog";

afterEach(cleanup);

const row = { job: "videos", title: "Video", options: [], recommended: null } as unknown as GlanceRow;
const initial = (): SlotDrafts => ({ reduced: draftOf(undefined, "reduced"), standard: draftOf(undefined, "standard"), boost: draftOf(undefined, "boost"), max: draftOf(undefined, "max") });
const open = (onSave: (d: SlotDrafts) => void, picks: TierPicks | null = null) => render(<Dialog open><DialogContent><AiSlotChoices row={row} initial={initial()} picks={picks} copy={{}} saving={false} error={null} onClose={() => {}} onSave={onSave} /></DialogContent></Dialog>);

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

describe("AiSlotChoices with the Stack's candidates", () => {
  const level = (tier: "standard" | "boost" | "max", zFits: boolean) => ({ tier, cap_bytes: 24e9, recommended: "ernie-image-turbo", candidates: [
    { id: "ernie-image-turbo", label: "ERNIE Image Turbo", family: "ernie", peak_bytes: 18.8e9, verified: true, fits: true, refusal: null },
    { id: "z-image-turbo", label: "Z-Image Turbo", family: "z-image", peak_bytes: 25.8e9, verified: true, fits: zFits, refusal: zFits ? null : "This needs 26 GB. Standard keeps Home free, so it can't hold it. Use Boost or Max." },
  ] });
  const picks: TierPicks = { profile: "p64", room_bytes: 40e9, levels: [level("standard", false), level("boost", true), level("max", true)] };

  test("candidates are grouped by family, a model too big for Standard is disabled with the Stack's sentence, and Boost can take it", () => {
    const view = open(() => {}, picks);
    expect(view.getByTestId("ai-slot-standard-family-ernie")).toBeTruthy();
    expect(view.getByTestId("ai-slot-standard-family-z-image").textContent).toContain("Use Boost or Max");
    expect(view.getByTestId("ai-slot-standard").querySelector("#ai-slot-standard-z-image-turbo")!.hasAttribute("disabled")).toBe(true);
    expect(view.getByTestId("ai-slot-boost").querySelector("#ai-slot-boost-z-image-turbo")!.hasAttribute("disabled")).toBe(false);
    expect(view.getAllByText(/keep the same look and voice at every level/).length).toBeGreaterThan(0);
  });

  test("picking a model saves its id in that level only", () => {
    const save = mock((_: SlotDrafts) => {});
    const view = open(save, picks);
    fireEvent.click(view.getByTestId("ai-slot-boost").querySelector("#ai-slot-boost-z-image-turbo")!);
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    expect(save.mock.calls[0]![0].boost.model).toBe("z-image-turbo");
    expect(save.mock.calls[0]![0].standard.model).toBe("recommended");
  });
});
