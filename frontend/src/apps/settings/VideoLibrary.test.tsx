// VIDEO-GEN-04: the video half of the Pictures and videos settings view.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { VideoLibrary, videoStateLine } from "@/apps/settings/VideoLibrary";
import { videosApi, type VideoAdapterRow, type VideoSettings } from "@/lib/videosApi";
import { componentsApi, type ComponentRow } from "@/lib/componentsApi";

afterEach(cleanup);

const style = (over: Partial<VideoAdapterRow> = {}): VideoAdapterRow => ({ id: "lora-a", name: "Old Colour Film", classification: "all-ages", enabled: true, needs_confirmation: false, sha256: "a".repeat(64), base_model: "wan2.2-ti2v-5b", trigger_words: ["HST style"], licence: "Apache-2.0", strength_default: 1, bytes: 323_000_000, source_url: null, added_at: "2026-10-17", ...over });
const settings = (over: Partial<VideoSettings> = {}): VideoSettings => ({
  state: "idle", available: true, reason: null, tier: "p128", model_installed: true, limits: "Videos are 5 seconds at 480p and take about 2 minutes.", enabled: true, adult_adapters: true,
  minors: "Videos are off for children and teens. No setting turns them on.", adapters: [style(), style({ id: "lora-b", name: "Boudoir Motion", classification: "adult-only", licence: "acknowledged" })], ...over,
});
const LICENCE = { id: "ltx-2.x-community-2026-08-11", name: "LTX-2.x Community License Agreement (2026-08-11)", url: "https://example.com/licence", summary: ["Free under $10 million a year.", "Never to harm or exploit children."], accepted_at: null as string | null };
const detailedRow = (over: Partial<ComponentRow> = {}): ComponentRow => ({
  id: "ltx-2-3-distilled-mlx", label: "Video: Detailed (LTX-2.3)", summary: "", group: "video", kind: "model", state: "notInstalled", size_bytes: null, download_bytes: 73_572_000_000, full_bytes: 73_572_000_000, required_free_bytes: 0,
  plan_need: "optional", requirement: "optional", requirement_reason: null, last_used_at: null, used_by: [], depends_on: [], job: null, percent: null, failure: null, licence: LICENCE, can_install: true, install_block: null, can_uninstall: false, uninstall_block: null, ...over,
});
const withDetailed = (over: Partial<NonNullable<VideoSettings["detailed"]>> = {}): Partial<VideoSettings> => ({
  quality: "quick", detailed: { installed: false, available: true, reason: null, download_bytes: 73_572_000_000, component: "ltx-2-3-distilled-mlx", licence: { id: LICENCE.id, name: LICENCE.name, url: LICENCE.url }, lora_base_model: "ltx-2.3", ...over },
});
function mount(data: VideoSettings, row: ComponentRow = detailedRow()) {
  const original = { ...videosApi };
  const componentsOriginal = { ...componentsApi };
  componentsApi.list = mock(async () => ({ stack: "ok" as const, message: null, tier: "p128", free_disk_bytes: 1e12, disk_margin_bytes: 5e9, installed_bytes: 0, components: [row] }));
  componentsApi.install = mock(async (id: string) => ({ job: "job-1", component: id }));
  videosApi.settings = mock(async () => data);
  videosApi.setAdapter = mock(async (id: string, patch: { enabled?: boolean }) => ({ ...style({ id }), ...patch }));
  videosApi.removeAdapter = mock(async () => ({ ok: true as const }));
  videosApi.addAdapter = mock(async () => style({ id: "lora-new", enabled: false, needs_confirmation: true }));
  const view = renderWithQueryClient(<VideoLibrary />);
  return { ...view, restore: () => { Object.assign(videosApi, original); Object.assign(componentsApi, componentsOriginal); } };
}

describe("video settings view", () => {
  test("states the model in plain words with the tier limits, locks children and teens off, and badges each style", async () => {
    const v = mount(settings());
    await waitFor(() => expect(v.getByText("Quick and Detailed videos")).toBeTruthy());
    expect(v.getByText(/5 seconds with no sound, in about 2 minutes\./)).toBeTruthy();
    expect(v.getByLabelText("Children can make videos")).toBeDisabled();
    expect(v.getByLabelText("Teens can make videos")).toBeDisabled();
    expect(v.getByLabelText("Adults can make videos").getAttribute("aria-checked")).toBe("true");
    expect(v.getByText("Adults only")).toBeTruthy();
    expect(v.getByText("All ages")).toBeTruthy();
    v.restore();
  });

  test("a computer that cannot make videos says why, and adults read as off when the household switched them off", async () => {
    expect(videoStateLine(settings({ available: false, reason: "Video needs a computer with 128 GB of memory; this one has 64 GB." }))).toContain("128 GB");
    expect(videoStateLine(settings({ model_installed: false }))).toContain("No video model is installed");
    const v = mount(settings({ enabled: false }));
    await waitFor(() => expect(v.getByLabelText("Adults can make videos").getAttribute("aria-checked")).toBe("false"));
    v.restore();
  });

  test("a new style waits for a confirmation showing its fingerprint, then Turn it on switches it on", async () => {
    const v = mount(settings({ adapters: [style({ id: "lora-new", name: "Ink", enabled: false, needs_confirmation: true, sha256: "f".repeat(64) })] }));
    await waitFor(() => expect(v.getByText("Check this before you turn it on")).toBeTruthy());
    expect(v.getByText("f".repeat(64))).toBeTruthy();
    fireEvent.click(v.getByRole("button", { name: "Turn it on" }));
    await waitFor(() => expect(videosApi.setAdapter).toHaveBeenCalledWith("lora-new", { enabled: true }));
    v.restore();
  });

  test("a style with no age claim is adults only by default", async () => {
    const v = mount(settings({ adapters: [] }));
    await waitFor(() => expect(v.getByText("Add a video style")).toBeTruthy());
    fireEvent.change(v.getByLabelText("Name"), { target: { value: "Ink" } });
    const input = v.getByLabelText(/The \.safetensors file/) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array(8)], "ink.safetensors")], configurable: true });
    fireEvent.change(input);
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(videosApi.addAdapter).toHaveBeenCalled());
    const form = (videosApi.addAdapter as unknown as { mock: { calls: FormData[][] } }).mock.calls[0]![0]!;
    expect(form.get("classification")).toBe("adult-only");
    expect(form.get("name")).toBe("Ink");
    expect(form.get("looks_like")).toBeNull();
    v.restore();
  });

  test("Detailed videos downloading shows the download card with its percent", async () => {
    const v = mount(settings(withDetailed()), detailedRow({ state: "installing", percent: 40 }));
    expect(await v.findByRole("progressbar", { name: "Detailed videos progress" })).toBeTruthy();
    v.restore();
  });

  test("Detailed videos: the plain size on the button, the licence read and accepted once, then the install starts with that licence", async () => {
    const v = mount(settings(withDetailed()));
    const get = await v.findByRole("button", { name: /Get Detailed videos \(74 GB\)/ });
    fireEvent.click(get);
    expect(await v.findByText("Free under $10 million a year.")).toBeTruthy();
    expect(v.getByText("Never to harm or exploit children.")).toBeTruthy();
    expect(componentsApi.install).not.toHaveBeenCalled();
    fireEvent.click(v.getByRole("button", { name: "I accept, get it" }));
    await waitFor(() => expect(componentsApi.install).toHaveBeenCalledWith("ltx-2-3-distilled-mlx", LICENCE.id));
    v.restore();
  });

  test("once the licence was accepted the button installs at once; installed shows On this computer; model names stay under Details", async () => {
    const accepted = mount(settings(withDetailed()), detailedRow({ licence: { ...LICENCE, accepted_at: "2026-10-17T12:00:00Z" } }));
    fireEvent.click(await accepted.findByRole("button", { name: /Get Detailed videos/ }));
    await waitFor(() => expect(componentsApi.install).toHaveBeenCalledWith("ltx-2-3-distilled-mlx", undefined));
    accepted.restore();
    cleanup();
    const done = mount(settings(withDetailed({ installed: true, download_bytes: 0 })), detailedRow({ state: "installed" }));
    await waitFor(() => expect(done.getAllByText("On this computer").length).toBe(2));
    expect(done.queryByRole("button", { name: /Get Detailed videos/ })).toBeNull();
    expect(done.queryByText(/LTX/)).toBeNull();
    done.restore();
  });

  test("Detailed chosen but not installed says chat makes Quick until it is; a computer without the memory shows no Get button", async () => {
    const chosen = mount(settings({ ...withDetailed(), quality: "detailed" }));
    await waitFor(() => expect(chosen.getByText("Detailed is chosen, but it is not ready")).toBeTruthy());
    chosen.restore();
    cleanup();
    const small = mount(settings(withDetailed({ available: false, reason: "This computer does not have the memory for Detailed videos." })));
    await waitFor(() => expect(small.getByText(/does not have the memory/)).toBeTruthy());
    expect(small.queryByRole("button", { name: /Get Detailed videos/ })).toBeNull();
    small.restore();
  });
});
