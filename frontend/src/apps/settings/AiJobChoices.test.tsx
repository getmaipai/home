// AIMODELS-CHOICES-01: the one card body every job on the AI and models page uses.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import table from "../../../../shared/diskPlan.json";
import type { DiskPlan } from "../../../../shared/diskPlanMath";
import { buildAiCards, type AiChoicesInput, type AiComponentLike } from "../../../../shared/aiChoices";
import { AiJobChoices } from "@/apps/settings/AiJobChoices";

afterEach(cleanup);

const GIB = 1024 ** 3;
const plan = (table as unknown as { tiers: Record<string, DiskPlan> }).tiers.p128!;
const settings = { pictureQuality: "quick", videoQuality: "quick", musicEnabled: true } as const;
function part(id: string, over: Partial<AiComponentLike> = {}): AiComponentLike {
  return { id, label: id, state: "installed", size_bytes: GIB, download_bytes: GIB, requirement: "optional", requirement_reason: null, percent: null, job: null, failure: null, can_install: true, can_uninstall: true, last_used_at: null, used_by: [], ...over };
}
/** Every model of the plan as an installed part, with a few overrides by plan row id. */
function components(over: Record<string, Partial<AiComponentLike>> = {}): AiComponentLike[] {
  return plan.rows.filter((row) => row.kind === "model").flatMap((row) => row.model_ids.slice(0, 1).map((id) => part(id, { state: "installed", ...(over[row.id] ?? {}) })));
}
function cardOf(job: string, over: Record<string, Partial<AiComponentLike>> = {}, input: Partial<AiChoicesInput> = {}) {
  return buildAiCards({ plan, components: components(over), settings, freeBytes: 800 * GIB, ...input }).cards.find((card) => card.id === job)!;
}
const MODEL_WORDS = /FLUX|Klein|ERNIE|Z-Image|Wan2|LTX|Qwen|Muse|Chatterbox|Pocket|ACE-Step|\bMB\b/;

describe("a job card", () => {
  test("shows the title, the sentence, the chip and exactly one Recommended mark on a radio card", () => {
    const view = render(<AiJobChoices card={cardOf("pictures", { "pictures-zimage": { state: "notInstalled" } })} onAct={() => {}} />);
    expect(view.getByRole("heading", { name: "Pictures" })).toBeTruthy();
    expect(view.getByText("Make pictures in chat and change the ones you have.")).toBeTruthy();
    expect(view.getByTestId("ai-chip-pictures").textContent).toBe("Using Quick");
    expect(view.getAllByText("Recommended").length).toBe(2); // Quick, and the Tools switch the plan recommends
    const quick = view.getByTestId("ai-choice-pictures.quick");
    expect(within(quick).getByText("Recommended")).toBeTruthy();
    expect(within(view.getByTestId("ai-choice-pictures.detailed")).queryByText("Recommended")).toBeNull();
  });

  test("marks the current choice with a filled radio, and the other with its size", () => {
    const view = render(<AiJobChoices card={cardOf("pictures", { "pictures-zimage": { state: "notInstalled" } })} onAct={() => {}} />);
    expect(view.getByTestId("ai-choice-pictures.quick").getAttribute("data-current")).toBe("true");
    expect(view.getByTestId("ai-choice-pictures.detailed").getAttribute("data-current")).toBe("false");
    expect((view.getByRole("radio", { name: /^Quick/ }) as HTMLElement).getAttribute("aria-checked")).toBe("true");
    expect((view.getByRole("radio", { name: /^Detailed/ }) as HTMLElement).getAttribute("aria-checked")).toBe("false");
    expect(within(view.getByTestId("ai-choice-pictures.detailed")).getByText(/Not installed, \d+ GB/)).toBeTruthy();
  });

  test("a choice that is not installed has one action, Get and use, and pressing it calls onAct", async () => {
    const onAct = mock(async () => {});
    const view = render(<AiJobChoices card={cardOf("pictures", { "pictures-zimage": { state: "notInstalled" } })} onAct={onAct} />);
    fireEvent.click(view.getByRole("button", { name: "Get and use Detailed" }));
    await waitFor(() => expect(onAct).toHaveBeenCalledTimes(1));
    expect((onAct.mock.calls[0] as unknown[])[0]).toMatchObject({ id: "pictures.detailed", action: "get" });
    expect(view.queryByRole("button", { name: "Get and use Quick" })).toBeNull();
  });

  test("an installed choice that is not current says Use this", async () => {
    const onAct = mock(async () => {});
    const view = render(<AiJobChoices card={cardOf("pictures")} onAct={onAct} />);
    fireEvent.click(within(view.getByTestId("ai-choice-pictures.detailed")).getByRole("button", { name: "Use this" }));
    await waitFor(() => expect(onAct).toHaveBeenCalledTimes(1));
    expect((onAct.mock.calls[0] as unknown[])[0]).toMatchObject({ id: "pictures.detailed", action: "use" });
  });

  test("a chosen but not installed choice reads Chosen, not ready with the Alert", () => {
    const card = cardOf("pictures", { "pictures-zimage": { state: "notInstalled" } }, { settings: { ...settings, pictureQuality: "detailed" } });
    const view = render(<AiJobChoices card={card} onAct={() => {}} />);
    expect(view.getByTestId("ai-chip-pictures").textContent).toBe("Chosen, not ready");
    expect(view.getByText("Detailed pictures is chosen, but it is not ready")).toBeTruthy();
  });

  test("a choice this computer cannot hold stays visible, disabled, with the reason and the numbers", () => {
    const card = cardOf("pictures", { "pictures-zimage": { state: "notInstalled" } }, { freeBytes: 20 * GIB });
    const view = render(<AiJobChoices card={card} onAct={() => {}} />);
    const row = view.getByTestId("ai-choice-pictures.detailed");
    expect(within(row).getByText(/Needs about \d+ GB free\. This computer has 20 GB free\./)).toBeTruthy();
    expect((view.getByRole("radio", { name: /^Detailed/ }) as HTMLElement).hasAttribute("disabled") || (view.getByRole("radio", { name: /^Detailed/ }) as HTMLElement).getAttribute("aria-disabled") === "true").toBe(true);
    expect(within(row).queryByRole("button")).toBeNull();
  });

  test("an installing choice shows its progress bar and no second action", () => {
    const card = cardOf("pictures", { "pictures-zimage": { state: "installing", percent: 40, job: "j1" } });
    const view = render(<AiJobChoices card={card} onAct={() => {}} />);
    expect(view.getByRole("progressbar", { name: /Getting Detailed pictures/ })).toBeTruthy();
    expect(within(view.getByTestId("ai-choice-pictures.detailed")).queryByRole("button")).toBeNull();
  });

  test("a failed install says Did not finish and offers Try again", async () => {
    const onAct = mock(async () => {});
    const card = cardOf("pictures", { "pictures-zimage": { state: "failed", failure: "The download stopped." } });
    const view = render(<AiJobChoices card={card} onAct={onAct} />);
    expect(within(view.getByTestId("ai-choice-pictures.detailed")).getByText(/Did not finish\. Try again\./)).toBeTruthy();
    fireEvent.click(within(view.getByTestId("ai-choice-pictures.detailed")).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onAct).toHaveBeenCalledTimes(1));
  });

  test("a switch that is on asks before it turns off, and a switch that is off turns on with one press", async () => {
    const onAct = mock(async () => {});
    const card = cardOf("coding", { coding: { state: "installed" } });
    const view = render(<AiJobChoices card={card} onAct={onAct} />);
    const toggle = view.getByRole("switch", { name: "Coding helper" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(await view.findByText("Turn off Coding helper?")).toBeTruthy();
    expect(onAct).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(onAct).toHaveBeenCalledTimes(1));
    cleanup();
    const off = cardOf("coding", { coding: { state: "notInstalled" } });
    const view2 = render(<AiJobChoices card={off} onAct={onAct} />);
    fireEvent.click(view2.getByRole("switch", { name: "Coding helper" }));
    await waitFor(() => expect(onAct).toHaveBeenCalledTimes(2));
  });

  test("a card with no rows on this computer says so plainly", () => {
    const small = (table as unknown as { tiers: Record<string, DiskPlan> }).tiers.p16!;
    const card = buildAiCards({ plan: small, components: null, settings, freeBytes: 100 * GIB }).cards.find((c) => c.id === "videos")!;
    const view = render(<AiJobChoices card={card} onAct={() => {}} />);
    expect(view.getAllByText(/not on this computer/i).length).toBeGreaterThan(0);
    expect(view.queryByRole("radio")).toBeNull();
  });

  test("model names and MB figures appear only under Details", async () => {
    for (const job of ["chat", "pictures", "videos", "music", "voice", "coding", "search"]) {
      const view = render(<AiJobChoices card={cardOf(job, { "pictures-zimage": { state: "notInstalled" } })} onAct={() => {}} />);
      expect(view.container.textContent ?? "").not.toMatch(MODEL_WORDS);
      const details = view.queryByRole("button", { name: "Details" });
      if (details) {
        fireEvent.click(details);
        await waitFor(() => expect(view.container.textContent ?? "").toMatch(MODEL_WORDS));
      }
      cleanup();
    }
  });
});
