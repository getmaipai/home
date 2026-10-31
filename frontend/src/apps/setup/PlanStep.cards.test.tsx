import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { PlanStep } from "./PlanStep";
import { cardsFor } from "./planFixtures";
import type { PlanDiskView, PlanRead } from "@/lib/api";
import table from "../../../../shared/diskPlan.json";
import { selectionTotals, sizeGb, needGb, type DiskPlan } from "../../../../shared/diskPlanMath";

afterEach(cleanup);

const GIB = 1024 ** 3;
const plans = (table as unknown as { tiers: Record<string, DiskPlan> }).tiers;

function read(tier: "p16" | "p64" | "p128", free: number | null, over: Partial<PlanDiskView> = {}, extra: Partial<PlanRead> = {}, planOverride?: DiskPlan): PlanRead {
  const plan = planOverride ?? plans[tier]!;
  const disk: PlanDiskView = { source: "shipped", plan, volumes: [{ freeBytes: free, needs: ["home", "data", "ai"] }], verdict: { state: "green", text: "", fix: "", requiredBytes: 0, freeBytes: free }, ...over };
  return { wording: { level: plan.level, headline: `${plan.level} setup for this computer`, detail: "Fits.", gets: ["Chat with Home"], needsMemoryAnswer: false, sizeLine: "x", diskLine: null, disk }, choices: cardsFor(plan), ...extra };
}
const jobs = (view: ReturnType<typeof render>) => view.getByRole("group", { name: "What gets installed" });
const sw = (view: ReturnType<typeof render>, title: string) => view.getByRole("switch", { name: new RegExp(`^${title}: `) });

describe("the plan step's job cards", () => {
  test("a job the Stack says no tier can run stays off, cannot be switched on, and is not sent to download", async () => {
    const start = mock(async () => ({}));
    const view = render(<PlanStep readPlan={async () => read("p128", 800 * GIB, {}, { cannot_run: ["videos"] })} start={start} onInstalled={() => {}} />);
    await view.findByRole("group", { name: "What gets installed" });
    const videos = sw(view, "Videos");
    expect(videos.getAttribute("aria-checked")).toBe("false");
    expect((videos as HTMLButtonElement).disabled).toBe(true);
    expect(within(view.getByTestId("plan-job-videos")).getByText(/can't run this/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Install and continue" }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    const rows = (start.mock.calls[0] as unknown[])[1] as string[];
    expect(rows.some((id) => id.startsWith("videos"))).toBe(false);
  });
  test("shows a card per job with the chosen model's size, the total, the free space and a check", async () => {
    const plan = plans.p128!;
    const view = render(<PlanStep readPlan={async () => read("p128", 800 * GIB)} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByRole("group", { name: "What gets installed" });
    expect(within(jobs(view)).getByTestId("plan-job-videos")).toBeTruthy();
    expect(within(view.getByTestId("plan-job-videos")).getByText(sizeGb(cardsFor(plan).cards.find((card) => card.id === "videos")!.choices.find((choice) => choice.id === "videos.quick")!.installedBytes))).toBeTruthy();
    expect(view.queryByRole("checkbox", { name: /Make videos/ })).toBeNull();
    expect(view.getByText("Total on disk")).toBeTruthy();
    expect(view.getByText(sizeGb(selectionTotals(plan, plan.default_selected).installed_bytes))).toBeTruthy();
    expect(view.getByText(/Free space on this computer: 800 GB/)).toBeTruthy();
    expect(view.getByText(/There is enough room/)).toBeTruthy();
    expect(view.getByRole("button", { name: "Install and continue" })).toBeTruthy();
  });

  test("required jobs have a switch that cannot be turned off; optional ones start off", async () => {
    const view = render(<PlanStep readPlan={async () => read("p128", 800 * GIB)} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByRole("group", { name: "What gets installed" });
    expect((sw(view, "Job chat") as HTMLButtonElement).disabled).toBe(true);
    expect(sw(view, "Job music").getAttribute("aria-checked")).toBe("false");
    expect(sw(view, "Videos").getAttribute("aria-checked")).toBe("true");
    expect(sw(view, "More picture styles").getAttribute("aria-checked")).toBe("false");
  });

  test("turning a job on raises the total and the space needed; turning it off lowers them again", async () => {
    const plan = plans.p128!;
    const view = render(<PlanStep readPlan={async () => read("p128", 800 * GIB)} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByRole("group", { name: "What gets installed" });
    const before = selectionTotals(plan, plan.default_selected);
    fireEvent.click(sw(view, "More picture styles"));
    const more = selectionTotals(plan, [...plan.default_selected, "pictures-zimage"]);
    await waitFor(() => expect(view.getByText(sizeGb(more.installed_bytes))).toBeTruthy());
    expect(view.getByText(new RegExp(`Free space needed while it installs: about ${needGb(more.required_free_bytes + 2 * GIB)} GB`))).toBeTruthy();
    fireEvent.click(sw(view, "More picture styles"));
    await waitFor(() => expect(view.getByText(sizeGb(before.installed_bytes))).toBeTruthy());
  });

  test("a red check blocks Install; turning a job off can make it pass, and the install sends the ids and settings", async () => {
    const plan = plans.p64!;
    const without = plan.default_selected.filter((id) => id !== "pictures-ernie");
    const fits = selectionTotals(plan, without).required_free_bytes + 2 * GIB + plan.headroom_warn_bytes + GIB;
    const start = mock(async () => ({}));
    const done = mock(() => {});
    const view = render(<PlanStep readPlan={async () => read("p64", fits)} start={start} onInstalled={done} />);
    await view.findByRole("group", { name: "What gets installed" });
    expect(view.getByText(/This computer needs about \d+ GB free for the recommended setup; it has \d+ GB\./)).toBeTruthy();
    expect(view.queryByRole("button", { name: "Install and continue" })).toBeNull();
    fireEvent.click(sw(view, "Job coding"));
    await waitFor(() => expect(view.queryByRole("button", { name: "Install and continue" })).not.toBeNull());
    fireEvent.click(view.getByRole("button", { name: "Install and continue" }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    const call = start.mock.calls[0] as unknown[];
    expect(call[1]).not.toContain("coding");
    expect(call[1]).toContain("pictures-ernie");
    expect(call[3]).toMatchObject({ "generation.picture_quick_model": "ernie" });
  });

  test("a tight disk warns and still installs", async () => {
    const plan = plans.p16!;
    const need = plan.default.required_free_bytes + 2 * GIB;
    const view = render(<PlanStep readPlan={async () => read("p16", need + GIB)} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByRole("group", { name: "What gets installed" });
    expect(view.getByText(/leaves little room/)).toBeTruthy();
    expect(view.getByRole("button", { name: "Install and continue" })).toBeTruthy();
  });

  test("a model already on this computer says Installed instead of a size", async () => {
    const plan: DiskPlan = { ...plans.p64!, rows: plans.p64!.rows.map((row) => row.id === "pictures-ernie" ? { ...row, installed: true } : row) };
    const choices = cardsFor(plan);
    const pictures = choices.cards.find((card) => card.id === "pictures")!;
    pictures.choices = pictures.choices.map((choice) => choice.rowIds.includes("pictures-ernie") ? { ...choice, state: "installed" } : choice);
    const view = render(<PlanStep readPlan={async () => read("p64", 800 * GIB, { source: "stack" }, { choices }, plan)} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByRole("group", { name: "What gets installed" });
    expect(within(view.getByTestId("plan-job-pictures")).getByText("Installed")).toBeTruthy();
  });

  const licence = { row_id: "video-detailed", component: "ltx-2-3-distilled-mlx", id: "ltx-2.x-community-2026-08-11", name: "LTX-2 Community License", url: "https://example.com/licence", summary: ["It is free for a person or a business that earns under $10 million a year.", "The markings the model puts in a clip are never removed."], accepted_at: null };
  const pickDetailed = (view: ReturnType<typeof render>) => fireEvent.click(view.getByRole("radio", { name: /Detailed videos/ }));

  test("choosing Detailed videos shows the licence plainly and Install waits for the accept", async () => {
    const start = mock(async () => ({}));
    const view = render(<PlanStep readPlan={async () => read("p128", 800 * GIB, {}, { licences: [licence] })} start={start} onInstalled={() => {}} />);
    await view.findByRole("group", { name: "What gets installed" });
    expect(view.queryByTestId("plan-licence")).toBeNull();
    pickDetailed(view);
    expect(view.getByText(/under \$10 million a year/)).toBeTruthy();
    const install = view.getByRole("button", { name: "Install and continue" }) as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    expect(view.getByTestId("plan-accept-hint").textContent).toMatch(/waiting for you to accept the maker's licence/);
    fireEvent.click(view.getByRole("checkbox", { name: /I have read it and I accept it/ }));
    await waitFor(() => expect(install.disabled).toBe(false));
    fireEvent.click(install);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const call = start.mock.calls[0] as unknown[];
    expect(call[1]).toContain("video-detailed");
    expect(call[1]).not.toContain("video");
    expect(call[2]).toEqual([licence.id]);
    expect(call[3]).toMatchObject({ "generation.video_quality": "detailed" });
  });

  test("a covered licence is information: no accept is needed", async () => {
    const start = mock(async () => ({}));
    const view = render(<PlanStep readPlan={async () => read("p128", 800 * GIB, {}, { licences: [{ ...licence, covered: true }] })} start={start} onInstalled={() => {}} />);
    await view.findByRole("group", { name: "What gets installed" });
    pickDetailed(view);
    expect(view.queryByTestId("plan-licence")).toBeNull();
    expect(view.getByTestId("plan-licence-info").textContent).toMatch(/You accepted its licence at the start/);
    fireEvent.click(view.getByRole("button", { name: "Install and continue" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect((start.mock.calls[0] as unknown[])[2]).toEqual([]);
  });

  test("going back to Quick videos, or turning Videos off, drops the licence and sends no accept", async () => {
    const start = mock(async () => ({}));
    const view = render(<PlanStep readPlan={async () => read("p128", 800 * GIB, {}, { licences: [licence] })} start={start} onInstalled={() => {}} />);
    await view.findByRole("group", { name: "What gets installed" });
    pickDetailed(view);
    expect(view.queryByTestId("plan-licence")).not.toBeNull();
    fireEvent.click(view.getByRole("radio", { name: /Quick videos/ }));
    expect(view.queryByTestId("plan-licence")).toBeNull();
    pickDetailed(view);
    fireEvent.click(sw(view, "Videos"));
    expect(view.queryByTestId("plan-licence")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Install and continue" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const call = start.mock.calls[0] as unknown[];
    expect(call[1]).not.toContain("video-detailed");
    expect(call[2]).toEqual([]);
  });

  test("a click that has nothing to download says so, and a refusal from the engine shows as the red alert", async () => {
    const none = render(<PlanStep readPlan={async () => read("p128", 800 * GIB)} start={async () => ({ started: true, models: 0 })} onInstalled={() => {}} />);
    await none.findByRole("group", { name: "What gets installed" });
    fireEvent.click(none.getByRole("button", { name: "Install and continue" }));
    expect((await none.findByRole("status")).textContent).toMatch(/Nothing to download/);
    none.unmount();
    const { ApiError } = await import("@/lib/api");
    const refused = render(<PlanStep readPlan={async () => read("p128", 800 * GIB)} start={async () => { throw new ApiError("There is not enough room on the engine's disk.", 409, undefined, "Free some space, then press the button again."); }} onInstalled={() => {}} />);
    await refused.findByRole("group", { name: "What gets installed" });
    fireEvent.click(refused.getByRole("button", { name: "Install and continue" }));
    expect(await refused.findByText(/not enough room on the engine's disk\. Free some space/)).toBeTruthy();
    expect(refused.queryByRole("status")).toBeNull();
  });

  test("a started download is answered under the button", async () => {
    const view = render(<PlanStep readPlan={async () => read("p128", 800 * GIB)} start={async () => ({ started: true, models: 1 })} onInstalled={() => {}} />);
    await view.findByRole("group", { name: "What gets installed" });
    fireEvent.click(view.getByRole("button", { name: "Install and continue" }));
    expect((await view.findByRole("status")).textContent).toMatch(/Download started\. Watch it in the bar at the top/);
  });
});
