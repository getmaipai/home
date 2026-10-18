import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { PlanStep } from "./PlanStep";
import type { PlanDiskView, PlanWording } from "@/lib/api";
import table from "../../../../shared/diskPlan.json";
import { selectionTotals, sizeGb, needGb, type DiskPlan } from "../../../../shared/diskPlanMath";

afterEach(cleanup);

const GIB = 1024 ** 3;
const plans = (table as unknown as { tiers: Record<string, DiskPlan> }).tiers;

function wording(tier: "p16" | "p64" | "p128", free: number | null, over: Partial<PlanDiskView> = {}): PlanWording {
  const plan = plans[tier]!;
  const disk: PlanDiskView = { source: "shipped", plan, volumes: [{ freeBytes: free, needs: ["home", "data", "ai"] }], verdict: { state: "green", text: "", fix: "", requiredBytes: 0, freeBytes: free }, ...over };
  return { level: plan.level, headline: `${plan.level} setup for this computer`, detail: "Fits.", gets: ["Chat with Home"], needsMemoryAnswer: false, sizeLine: "x", diskLine: null, disk };
}
const list = (view: ReturnType<typeof render>) => view.getByRole("list", { name: "What gets installed" });

describe("the plan step's disk list", () => {
  test("lists every install with its size, marks need, and shows the total, the free space and a check", async () => {
    const plan = plans.p128!;
    const view = render(<PlanStep readPlan={async () => ({ wording: wording("p128", 800 * GIB) })} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByText("What gets installed");
    const rows = within(list(view));
    expect(rows.getByText(/Make videos \(Wan2\.2\)/)).toBeTruthy();
    expect(rows.getByText(/More picture styles \(Z-Image Turbo\)/)).toBeTruthy();
    const videoSize = sizeGb(plan.rows.find((row) => row.id === "video")!.installed_bytes);
    expect(rows.getByText(videoSize)).toBeTruthy();
    expect(view.getByText("Total on disk")).toBeTruthy();
    const total = selectionTotals(plan, plan.default_selected);
    expect(view.getByText(sizeGb(total.installed_bytes))).toBeTruthy();
    expect(view.getByText(/Free space on this computer: 800 GB/)).toBeTruthy();
    expect(view.getByText(/There is enough room/)).toBeTruthy();
    expect(view.getByRole("button", { name: "Install and continue" })).toBeTruthy();
  });

  test("optional extras start off, recommended ones on, and required ones have no checkbox", async () => {
    const view = render(<PlanStep readPlan={async () => ({ wording: wording("p128", 800 * GIB) })} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByText("What gets installed");
    expect((view.getByRole("checkbox", { name: /Make videos/ }) as HTMLElement).getAttribute("aria-checked")).toBe("false");
    expect((view.getByRole("checkbox", { name: /More picture styles/ }) as HTMLElement).getAttribute("aria-checked")).toBe("false");
    expect((view.getByRole("checkbox", { name: /Make pictures/ }) as HTMLElement).getAttribute("aria-checked")).toBe("true");
    expect(view.queryByRole("checkbox", { name: /Chat AI/ })).toBeNull();
    expect(within(list(view)).getByText(/Chat AI \(Muse Glimmer 30B\)/)).toBeTruthy();
  });

  test("turning an extra on raises the total and the space needed; turning it off lowers them again", async () => {
    const plan = plans.p128!;
    const view = render(<PlanStep readPlan={async () => ({ wording: wording("p128", 800 * GIB) })} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByText("What gets installed");
    const before = selectionTotals(plan, plan.default_selected);
    expect(view.getByText(sizeGb(before.installed_bytes))).toBeTruthy();
    fireEvent.click(view.getByRole("checkbox", { name: /Make videos/ }));
    const withVideo = selectionTotals(plan, [...plan.default_selected, "video"]);
    await waitFor(() => expect(view.getByText(sizeGb(withVideo.installed_bytes))).toBeTruthy());
    expect(view.getByText(new RegExp(`Free space needed while it installs: about ${needGb(withVideo.required_free_bytes + 2 * GIB)} GB`))).toBeTruthy();
    fireEvent.click(view.getByRole("checkbox", { name: /Make videos/ }));
    await waitFor(() => expect(view.getByText(sizeGb(before.installed_bytes))).toBeTruthy());
  });

  test("a red check blocks Install and says how much is needed; turning an extra off can make it pass", async () => {
    const plan = plans.p64!;
    const withoutPictures = plan.default_selected.filter((id) => id !== "pictures");
    const fits = selectionTotals(plan, withoutPictures).required_free_bytes + 2 * GIB + plan.headroom_warn_bytes + GIB;
    const start = mock(async () => ({}));
    const done = mock(() => {});
    const view = render(<PlanStep readPlan={async () => ({ wording: wording("p64", fits) })} start={start} onInstalled={done} />);
    await view.findByText("What gets installed");
    expect(view.getByText(/This computer needs about \d+ GB free for the recommended setup; it has \d+ GB\. Free up space, or choose a smaller plan\./)).toBeTruthy();
    expect(view.getByText(/You can also turn off an extra above/)).toBeTruthy();
    expect(view.queryByRole("button", { name: "Install and continue" })).toBeNull();
    fireEvent.click(view.getByRole("checkbox", { name: /Make pictures/ }));
    const button = await view.findByRole("button", { name: "Install and continue" });
    expect(view.getByText(/There is enough room/)).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(start).toHaveBeenCalledWith(undefined, expect.arrayContaining(withoutPictures), []);
    expect((start.mock.calls[0] as unknown[])[1]).not.toContain("pictures");
  });

  test("a tight disk warns and still installs; the check names the space left", async () => {
    const plan = plans.p16!;
    const need = plan.default.required_free_bytes + 2 * GIB;
    const view = render(<PlanStep readPlan={async () => ({ wording: wording("p16", need + GIB) })} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByText("What gets installed");
    expect(view.getByText(/leaves little room/)).toBeTruthy();
    expect(view.getByRole("button", { name: "Install and continue" })).toBeTruthy();
  });

  test("the install sends the choice: the ids left on", async () => {
    const plan = plans.p128!;
    const start = mock(async () => ({}));
    const view = render(<PlanStep readPlan={async () => ({ wording: wording("p128", 800 * GIB) })} start={start} onInstalled={() => {}} />);
    await view.findByText("What gets installed");
    fireEvent.click(view.getByRole("checkbox", { name: /Make videos/ }));
    fireEvent.click(view.getByRole("button", { name: "Install and continue" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const sent = (start.mock.calls[0] as unknown[])[1] as string[];
    expect(sent).toContain("video");
    expect(sent).toContain("pictures");
    expect(sent).not.toContain("pictures-zimage");
    expect(new Set(sent)).toEqual(new Set([...plan.default_selected, "video"]));
  });

  test("a row already on this computer says so instead of a size", async () => {
    const plan: DiskPlan = { ...plans.p64!, rows: plans.p64!.rows.map((row) => row.id === "pictures" ? { ...row, installed: true } : row) };
    const view = render(<PlanStep readPlan={async () => ({ wording: wording("p64", 800 * GIB, { plan, source: "stack" }) })} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByText("What gets installed");
    const picturesItem = view.getByRole("checkbox", { name: /Make pictures/ }).closest("li")!;
    expect(within(picturesItem as HTMLElement).getByText("Installed")).toBeTruthy();
  });

  const licence = { row_id: "video-detailed", component: "ltx-2-3-distilled-mlx", id: "ltx-2.x-community-2026-08-11", name: "LTX-2 Community License", url: "https://example.com/licence", summary: ["It is free for a person or a business that earns under $10 million a year.", "The markings the model puts in a clip are never removed."], accepted_at: null };

  test("Detailed videos are checked by default on the 128 GB plan, the licence is shown plainly and Install waits for the accept", async () => {
    const start = mock(async () => ({}));
    const view = render(<PlanStep readPlan={async () => ({ wording: wording("p128", 800 * GIB), licences: [licence] })} start={start} onInstalled={() => {}} />);
    await view.findByText("What gets installed");
    const detailed = view.getByRole("checkbox", { name: /Detailed videos/ });
    expect(detailed.getAttribute("aria-checked")).toBe("true");
    expect(view.getByText(/under \$10 million a year/)).toBeTruthy();
    expect(view.getByText(/never removed/)).toBeTruthy();
    const install = view.getByRole("button", { name: "Install and continue" }) as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    fireEvent.click(view.getByRole("checkbox", { name: /I have read it and I accept it/ }));
    await waitFor(() => expect(install.disabled).toBe(false));
    fireEvent.click(install);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const call = start.mock.calls[0] as unknown[];
    expect(call[1]).toContain("video-detailed");
    expect(call[2]).toEqual([licence.id]);
  });

  test("unticking Detailed videos drops the licence and the need to accept, and sends no accept", async () => {
    const start = mock(async () => ({}));
    const view = render(<PlanStep readPlan={async () => ({ wording: wording("p128", 800 * GIB), licences: [licence] })} start={start} onInstalled={() => {}} />);
    await view.findByText("What gets installed");
    fireEvent.click(view.getByRole("checkbox", { name: /Detailed videos/ }));
    expect(view.queryByTestId("plan-licence")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Install and continue" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const call = start.mock.calls[0] as unknown[];
    expect(call[1]).not.toContain("video-detailed");
    expect(call[2]).toEqual([]);
  });

  test("with Detailed videos checked and too little free space the check goes red; unticking them updates the total and clears it", async () => {
    const plan = plans.p128!;
    const without = plan.default_selected.filter((id) => id !== "video-detailed");
    const free = selectionTotals(plan, without).required_free_bytes + 2 * GIB + plan.headroom_warn_bytes + GIB;
    const view = render(<PlanStep readPlan={async () => ({ wording: wording("p128", free), licences: [licence] })} start={async () => ({})} onInstalled={() => {}} />);
    await view.findByText("What gets installed");
    expect(view.getByText(/This computer needs about \d+ GB free/)).toBeTruthy();
    expect(view.queryByRole("button", { name: "Install and continue" })).toBeNull();
    fireEvent.click(view.getByRole("checkbox", { name: /Detailed videos/ }));
    await view.findByRole("button", { name: "Install and continue" });
    expect(view.getByText(/There is enough room/)).toBeTruthy();
  });
});
