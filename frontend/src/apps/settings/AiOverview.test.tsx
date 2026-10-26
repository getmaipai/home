// AIMODELS-PAGE-01: the AI and models Overview: the seven jobs, the header numbers, the one recommended button and its confirm,
// and Free up space. No model name appears outside a Details block.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import table from "../../../../shared/diskPlan.json";
import type { DiskPlan } from "../../../../shared/diskPlanMath";
import { buildAiCards, recommendedPlan, type AiComponentLike } from "../../../../shared/aiChoices";
import { AiOverview } from "@/apps/settings/AiOverview";
import { aiChoicesApi, type AiChoicesOverview } from "@/lib/aiChoicesApi";

afterEach(cleanup);

const GIB = 1024 ** 3;
const plan = (table as unknown as { tiers: Record<string, DiskPlan> }).tiers.p128!;
const MODEL_WORDS = /FLUX|Klein|ERNIE|Z-Image|Wan2|LTX|Qwen|Muse|Chatterbox|Pocket|ACE-Step|\bMB\b/;

function part(id: string, state: AiComponentLike["state"]): AiComponentLike {
  return { id, label: id, state, size_bytes: GIB, download_bytes: GIB, requirement: "optional", requirement_reason: null, percent: null, job: null, failure: null, can_install: true, can_uninstall: true, last_used_at: null, used_by: [] };
}
/** Installed: the plan's required rows and Quick pictures. Everything else not installed. */
function overview(over: { settings?: Partial<{ pictureQuality: "quick" | "detailed"; videoQuality: "quick" | "detailed"; musicEnabled: boolean }>; all?: boolean; free?: number } = {}): AiChoicesOverview {
  const components = plan.rows.filter((row) => row.kind === "model").flatMap((row) => row.model_ids.slice(0, 1).map((id) => part(id, over.all || row.need === "required" || row.id === "pictures-ernie" ? "installed" : "notInstalled")));
  const input = { plan, components, settings: { pictureQuality: "detailed" as const, videoQuality: "quick" as const, musicEnabled: true, ...over.settings }, freeBytes: over.free ?? 800 * GIB };
  const built = buildAiCards(input);
  return { stack: "ok", message: null, tier: "p128", free_disk_bytes: input.freeBytes, installed_bytes: 41 * GIB, cards: built.cards, alwaysOn: built.alwaysOn, recommended: recommendedPlan(input), unused_bytes: 0 };
}

function mount(data: AiChoicesOverview) {
  const original = { ...aiChoicesApi };
  aiChoicesApi.overview = mock(async () => data);
  aiChoicesApi.unused = mock(async () => ({ items: [], total_bytes: 0 }));
  aiChoicesApi.choose = mock(async () => ({ ok: true as const, started: [] }));
  aiChoicesApi.applyRecommended = mock(async () => ({ ok: true, changed: [], started: ["x"], already: [], skipped: [], needs_licence: [] }));
  const view = renderWithQueryClient(<MemoryRouter><AiOverview /></MemoryRouter>);
  return { ...view, restore: () => Object.assign(aiChoicesApi, original) };
}

describe("the AI and models Overview", () => {
  test("shows the seven jobs in order, the Always on line and the link to all parts", async () => {
    const v = mount(overview());
    await v.findByTestId("ai-card-chat");
    const order = Array.from(v.container.querySelectorAll("[data-testid^='ai-card-']")).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["ai-card-chat", "ai-card-pictures", "ai-card-videos", "ai-card-music", "ai-card-voice", "ai-card-coding", "ai-card-search"]);
    expect(v.getByTestId("ai-always-on").textContent).toMatch(/Always on: Home itself/);
    expect(v.getByRole("link", { name: "All parts, with names and sizes" }).getAttribute("href")).toBe("/settings/ai?tab=models");
    v.restore();
  });

  test("the header says what is used and free and what recommended takes", async () => {
    const v = mount(overview());
    const text = (await v.findByTestId("ai-summary")).textContent ?? "";
    expect(text).toMatch(/Using 41 GB\./);
    expect(text).toMatch(/800 GB free\./);
    expect(text).toMatch(/Everything recommended is \d+ GB to download\./);
    v.restore();
  });

  test("no model name or MB figure shows on the page until Details is opened", async () => {
    const v = mount(overview());
    await v.findByTestId("ai-card-chat");
    expect(v.container.textContent ?? "").not.toMatch(MODEL_WORDS);
    v.restore();
  });

  test("pressing Get and use on a choice sends the job and the choice id", async () => {
    const v = mount(overview({ settings: { pictureQuality: "quick" } }));
    fireEvent.click(await v.findByRole("button", { name: "Get and use Detailed" }));
    await waitFor(() => expect(aiChoicesApi.choose).toHaveBeenCalledWith("pictures", "pictures.detailed"));
    v.restore();
  });

  test("the recommended button confirms first, lists the changed choice before the download, then applies", async () => {
    const v = mount(overview());
    fireEvent.click(await v.findByRole("button", { name: "Set everything to recommended and download" }));
    const dialog = await v.findByRole("alertdialog");
    const text = dialog.textContent ?? "";
    expect(text).toMatch(/Pictures: Detailed to Quick/);
    expect(text.indexOf("Pictures: Detailed to Quick")).toBeLessThan(text.indexOf("downloads"));
    expect(text).toMatch(/Nothing is removed/);
    expect(aiChoicesApi.applyRecommended).not.toHaveBeenCalled();
    fireEvent.click(v.getByRole("button", { name: "Set to recommended and download" }));
    await waitFor(() => expect(aiChoicesApi.applyRecommended).toHaveBeenCalledTimes(1));
    expect(await v.findByText(/Set to recommended\. The downloads show in the bar at the top\./)).toBeTruthy();
    v.restore();
  });

  test("when everything is already recommended the button says so and is off", async () => {
    const v = mount(overview({ all: true, settings: { pictureQuality: "quick", musicEnabled: false } }));
    const button = await v.findByRole("button", { name: "Everything is set to recommended" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    v.restore();
  });

  test("with too little room the confirm says what will be skipped", async () => {
    const v = mount(overview({ free: 40 * GIB }));
    fireEvent.click(await v.findByRole("button", { name: "Set everything to recommended and download" }));
    expect((await v.findByRole("alertdialog")).textContent).toMatch(/will be skipped|Free up space first/);
    v.restore();
  });

  test("the engine not answering shows the destructive Alert and no cards", async () => {
    const v = mount({ ...overview(), stack: "unreachable", message: "The AI engine isn't answering. Check that the engine is running, then try again.", cards: [] });
    expect(await v.findByText("The AI engine isn't answering")).toBeTruthy();
    expect(v.queryByTestId("ai-card-chat")).toBeNull();
    v.restore();
  });

  test("Free up space opens the dialog", async () => {
    const v = mount(overview());
    fireEvent.click(await v.findByRole("button", { name: "Free up space" }));
    expect(await v.findByText("Everything installed is in use.")).toBeTruthy();
    v.restore();
  });
});
