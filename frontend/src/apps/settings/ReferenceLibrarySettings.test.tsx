import { afterEach, describe, expect, test, mock } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ReferenceLibrarySettings } from "@/apps/settings/ReferenceLibrarySettings";
import { api, type ReferenceCatalogSet, type ReferenceJob, type ReferencePlan } from "@/lib/api";

afterEach(cleanup);
const catalog: ReferenceCatalogSet[] = [
  { id: "vikidia:default", source: "vikidia", flavour: "default", name: "Vikidia", language: "English", sizeBytes: 2_000_000_000, sha256: "abc", snapshotDate: "2026-10-01", installed: true, child: true, wikipedia: false, bands: ["child", "teen", "adult"], available: true, message: null },
  { id: "wikipedia-en:mini", source: "wikipedia-en", flavour: "mini", name: "Wikipedia Mini", language: "English", sizeBytes: 5_000_000_000, sha256: "def", snapshotDate: "2026-10-01", installed: false, child: false, wikipedia: true, bands: ["child", "teen", "adult"], available: true, message: null },
];
const job: ReferenceJob = { id: "job-a", setId: "wikipedia-en:mini", state: "downloading", completedBytes: 2_500_000_000, totalBytes: 5_000_000_000, message: null };
const plan: ReferencePlan = { preset: "custom", sets: [catalog[1]!], totalBytes: 5_000_000_000, freeBytes: 50_000_000_000, freeAfterInstallBytes: 45_000_000_000, requiredFreeBytes: 10_000_000_000, refusal: null, swapHeadroomBytes: 0, estimatedSeconds: 100, warnings: [], settings: {} };
function mount(initialState = { installed: [{ id: "vikidia_en:nopic", name: "vikidia_en_all", book: "vikidia_en", language: "eng", flavour: "nopic", snapshotDate: "2026-10-01" }], jobs: [job], matchesPresets: [] as string[] }) {
  const original = { ...api };
  const calls: string[] = [];
  let state = initialState;
  api.referenceState = mock(async () => state);
  api.referenceCatalog = mock(async () => catalog);
  api.referencePlan = mock(async () => plan);
  api.referenceApply = mock(async () => { calls.push("apply"); return { jobs: [], idempotent: false }; });
  api.referenceInstall = mock(async () => { calls.push("install"); return job; });
  api.referenceRemove = mock(async () => { calls.push("remove"); return { removed: true, freedBytes: 1 }; });
  api.referenceJob = mock(async (_id: string, action: "pause" | "resume" | "cancel") => { calls.push(action); const next = { ...job, state: action === "pause" ? "paused" as const : action === "cancel" ? "cancelled" as const : "downloading" as const }; state = { ...state, jobs: action === "cancel" ? [] : [next] }; return next; });
  const result = renderWithQueryClient(<ReferenceLibrarySettings />);
  return { ...result, calls, restore: () => Object.assign(api, original) };
}

describe("Reference library settings", () => {
  test("shows installed and available sets with current metadata", async () => {
    const view = mount({ installed: [], jobs: [], matchesPresets: ["minimum"] });
    await waitFor(() => expect(view.getByText(/2.0 GB/)).toBeTruthy());
    expect(view.getByText(/Installed/)).toBeTruthy();
    expect(view.getByText(/Not installed/)).toBeTruthy();
    expect(view.getAllByText(/2026-10-01/)).toHaveLength(2);
    expect(view.getByText(/Minimum · Current/)).toBeTruthy();
    view.restore();
  });
  test("shows a plan refusal and cannot continue", async () => {
    const view = mount({ installed: [], jobs: [], matchesPresets: [] });
    (api.referencePlan as unknown as { mockResolvedValueOnce: (v: ReferencePlan) => void }).mockResolvedValueOnce({ ...plan, refusal: "Keep at least 20 percent of the drive free." });
    await waitFor(() => expect(view.getByRole("button", { name: "Install" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(view.getByText("Keep at least 20 percent of the drive free.")).toBeTruthy());
    expect(view.queryByRole("button", { name: "Install set" })).toBeNull();
    view.restore();
  });
  test("preset confirmation uses its label and preserves already installed sets", async () => {
    const view = mount({ installed: [], jobs: [], matchesPresets: [] });
    fireEvent.click((await view.findAllByRole("button", { name: "Select" }))[0]!);
    await waitFor(() => expect(view.getByText("Install the Minimum library?")).toBeTruthy());
    expect(view.getByText(/Sets you already have stay installed\./)).toBeTruthy();
    view.restore();
  });
  test("shows progress and supports pause, resume, and cancel", async () => {
    const view = mount();
    await waitFor(() => expect(view.getByRole("button", { name: "Pause" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Resume" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Pause" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(view.calls).toEqual(["pause", "resume", "cancel"]));
    view.restore();
  });
  test("groups books by topic and says in plain words what each version contains", async () => {
    const view = mount({ installed: [], jobs: [], matchesPresets: [] });
    expect(await view.findByRole("region", { name: "Encyclopedia" })).toBeTruthy();
    expect(view.getByText(/Short introductions only \(smallest\)/)).toBeTruthy();
    expect(view.getByText(/An encyclopedia written for children/)).toBeTruthy();
    view.restore();
  });
});
