import { afterEach, describe, expect, test, mock } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ReferenceLibrarySettings } from "@/apps/settings/ReferenceLibrarySettings";
import { api, type ReferenceCatalogSet, type ReferenceJob, type ReferencePlan } from "@/lib/api";

afterEach(cleanup);
const set = (over: Partial<ReferenceCatalogSet> & Pick<ReferenceCatalogSet, "source" | "flavour" | "name">): ReferenceCatalogSet => ({
  id: `${over.source}:${over.flavour}`, language: "English", sizeBytes: 2_000_000_000, sha256: "abc", snapshotDate: "2026-10-01", installed: false, child: false, wikipedia: false,
  bands: ["teen", "adult"], available: true, message: null, ...over,
});
const catalog: ReferenceCatalogSet[] = [
  set({ source: "vikidia", flavour: "default", name: "Vikidia", installed: true, child: true, bands: ["child", "teen", "adult"] }),
  set({ source: "wikipedia-simple", flavour: "default", name: "Simple English Wikipedia", child: true, bands: ["child", "teen", "adult"], sizeBytes: 3_000_000_000 }),
  set({ source: "wikipedia-en", flavour: "mini", name: "Wikipedia Mini", sizeBytes: 5_000_000_000, wikipedia: true }),
  set({ source: "wikipedia-en", flavour: "maxi", name: "Wikipedia with pictures", sizeBytes: 100_000_000_000, wikipedia: true }),
  set({ source: "medlineplus", flavour: "default", name: "MedlinePlus", sizeBytes: 1_000_000_000 }),
];
const plan: ReferencePlan = { preset: "custom", sets: [], totalBytes: 5_000_000_000, freeBytes: 50_000_000_000, freeAfterInstallBytes: 45_000_000_000, requiredFreeBytes: 10_000_000_000, refusal: null, swapHeadroomBytes: 0, estimatedSeconds: 100, warnings: [], settings: {} };
const job: ReferenceJob = { id: "job-a", setId: "wikipedia-en:mini", state: "downloading", completedBytes: 2_500_000_000, totalBytes: 5_000_000_000, message: null };

function mount(options: { jobs?: ReferenceJob[]; plan?: Partial<ReferencePlan> } = {}) {
  const original = { ...api };
  const calls: string[] = [];
  const jobs = options.jobs ?? [];
  api.referenceState = mock(async () => ({ installed: [], jobs, matchesPresets: [] as string[] }));
  api.referenceCatalog = mock(async () => catalog);
  api.hardware = mock(async () => ({ freeDiskBytes: 50_000_000_000 }) as never);
  api.referenceDisk = mock(async () => ({ totalBytes: 2_000_000_000_000, freeBytes: 1_000_000_000_000, booksBytes: 2_000_000_000 }));
  api.referencePlan = mock(async () => ({ ...plan, ...options.plan }));
  api.referenceInstall = mock(async (id: string) => { calls.push(`install ${id}`); return job; });
  api.referenceRemove = mock(async (id: string) => { calls.push(`remove ${id}`); return { removed: true, freedBytes: 1 }; });
  api.referenceJob = mock(async (_id: string, action: "pause" | "resume" | "cancel") => { calls.push(action); return job; });
  const result = renderWithQueryClient(<ReferenceLibrarySettings />);
  return { ...result, ...within(result.container), calls, restore: () => Object.assign(api, original) };
}

describe("Offline data settings", () => {
  test("lists one row per book under its topic, each with a switch, and shows the disk bar", async () => {
    const view = mount();
    expect(await view.findByRole("group", { name: "Encyclopedia" })).toBeTruthy();
    expect(view.getByRole("group", { name: "Health and medicine" })).toBeTruthy();
    expect(view.getByRole("switch", { name: "Vikidia: on" }).getAttribute("aria-checked")).toBe("true");
    expect(view.getByRole("switch", { name: "MedlinePlus: off" }).getAttribute("aria-checked")).toBe("false");
    expect(view.getByText(/2000 GB drive/)).toBeTruthy();
    expect(view.getByText(/1000 GB free · 2.0 GB of offline books/)).toBeTruthy();
    expect(view.getAllByText("For children").length).toBe(2);
    view.restore();
  });

  test("Wikipedia is one row with a version picker, not one row per size", async () => {
    const view = mount();
    await view.findByRole("group", { name: "Encyclopedia" });
    expect(view.getAllByText("Wikipedia", { selector: "[data-slot='item-title']" }).length).toBe(1);
    expect(view.getByRole("combobox", { name: "Wikipedia version" }).textContent).toContain("Off");
    view.restore();
  });

  test("switching a book on stages it, shows the size and time, and Apply downloads only that book", async () => {
    const view = mount();
    fireEvent.click(await view.findByRole("switch", { name: "MedlinePlus: off" }));
    expect(await view.findByText("1 change is waiting")).toBeTruthy();
    await waitFor(() => expect(view.getByText(/1 to download \(.*About 2 minutes\)/)).toBeTruthy());
    expect(view.calls).toEqual([]);
    fireEvent.click(view.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(view.calls).toEqual(["install medlineplus:default"]));
    view.restore();
  });

  test("Full, Moderate and Minimum set every row at once; nothing is written until Apply", async () => {
    const view = mount();
    await view.findByRole("group", { name: "Library size" });
    fireEvent.click(view.getByRole("button", { name: "Minimum" }));
    // Minimum keeps Vikidia and adds Simple English Wikipedia; nothing else is installed to remove.
    await waitFor(() => expect(view.getByRole("switch", { name: "Simple English Wikipedia: on" })).toBeTruthy());
    expect(view.calls).toEqual([]);
    fireEvent.click(view.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(view.getByRole("switch", { name: "Simple English Wikipedia: off" })).toBeTruthy());
    expect(view.queryByText(/changes? (is|are) waiting/)).toBeNull();
    view.restore();
  });

  test("removing an installed book asks first and names children's books, then removes on confirm", async () => {
    const view = mount();
    fireEvent.click(await view.findByRole("switch", { name: "Vikidia: on" }));
    fireEvent.click(await view.findByRole("button", { name: "Apply" }));
    expect(await within(document.body).findByText(/Children and teens may lose access to Vikidia/)).toBeTruthy();
    expect(view.calls).toEqual([]);
    fireEvent.click(within(document.body).getByRole("button", { name: "Remove and apply" }));
    await waitFor(() => expect(view.calls).toEqual(["remove vikidia:default"]));
    view.restore();
  });

  test("a plan refusal explains itself and keeps Apply off", async () => {
    const view = mount({ plan: { refusal: "Keep at least 20 percent of the drive free." } });
    fireEvent.click(await view.findByRole("switch", { name: "MedlinePlus: off" }));
    expect(await view.findByText("Keep at least 20 percent of the drive free.")).toBeTruthy();
    expect((view.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    view.restore();
  });

  test("a download in flight shows progress and pause, resume and cancel", async () => {
    const view = mount({ jobs: [job] });
    expect(await view.findByRole("progressbar", { name: "Wikipedia: short introductions only progress" })).toBeTruthy();
    expect(view.getByText(/2\.5 GB/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(view.calls).toContain("pause"));
    fireEvent.click(view.getByRole("button", { name: "Cancel the Wikipedia download" }));
    await waitFor(() => expect(view.calls).toContain("cancel"));
    view.restore();
  });
  test("a download waiting for the nightly window says so and can start now", async () => {
    const view = mount({ jobs: [{ ...job, state: "waiting_window", completedBytes: 0, message: "Waiting for the nightly download window." }] });
    expect(await view.findByText(/Waits for the nightly download window/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Start now" }));
    await waitFor(() => expect(view.calls).toContain("resume"));
    view.restore();
  });
});
