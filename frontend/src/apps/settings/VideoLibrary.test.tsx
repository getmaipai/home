// VIDEO-GEN-04: the video half of the Pictures and videos settings view.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { VideoLibrary, videoStateLine } from "@/apps/settings/VideoLibrary";
import { videosApi, type VideoAdapterRow, type VideoSettings } from "@/lib/videosApi";

afterEach(cleanup);

const style = (over: Partial<VideoAdapterRow> = {}): VideoAdapterRow => ({ id: "lora-a", name: "Old Colour Film", classification: "all-ages", enabled: true, needs_confirmation: false, sha256: "a".repeat(64), base_model: "wan2.2-ti2v-5b", trigger_words: ["HST style"], licence: "Apache-2.0", strength_default: 1, bytes: 323_000_000, source_url: null, added_at: "2026-10-17", ...over });
const settings = (over: Partial<VideoSettings> = {}): VideoSettings => ({
  state: "idle", available: true, reason: null, tier: "p128", model_installed: true, limits: "Videos are 5 seconds at 480p and take about 2 minutes.", enabled: true, adult_adapters: true,
  minors: "Videos are off for children and teens. No setting turns them on.", adapters: [style(), style({ id: "lora-b", name: "Boudoir Motion", classification: "adult-only", licence: "acknowledged" })], ...over,
});
function mount(data: VideoSettings) {
  const original = { ...videosApi };
  videosApi.settings = mock(async () => data);
  videosApi.setAdapter = mock(async (id: string, patch: { enabled?: boolean }) => ({ ...style({ id }), ...patch }));
  videosApi.removeAdapter = mock(async () => ({ ok: true as const }));
  videosApi.addAdapter = mock(async () => style({ id: "lora-new", enabled: false, needs_confirmation: true }));
  const view = renderWithQueryClient(<VideoLibrary />);
  return { ...view, restore: () => Object.assign(videosApi, original) };
}

describe("video settings view", () => {
  test("states the model in plain words with the tier limits, locks children and teens off, and badges each style", async () => {
    const v = mount(settings());
    await waitFor(() => expect(v.getByText("Wan 2.2 video model")).toBeTruthy());
    expect(v.getByText(/Videos are 5 seconds at 480p and take about 2 minutes\./)).toBeTruthy();
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

  test("an unsure answer adds the style as adults only", async () => {
    const v = mount(settings({ adapters: [] }));
    await waitFor(() => expect(v.getByText("Add a video style")).toBeTruthy());
    fireEvent.change(v.getByLabelText("Name"), { target: { value: "Ink" } });
    const input = v.getByLabelText(/The \.safetensors file/) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array(8)], "ink.safetensors")], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(v.getByRole("button", { name: "Add video style" })).not.toBeDisabled());
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(videosApi.addAdapter).toHaveBeenCalled());
    const form = (videosApi.addAdapter as unknown as { mock: { calls: FormData[][] } }).mock.calls[0]![0]!;
    expect(form.get("classification")).toBe("adult-only");
    expect(form.get("name")).toBe("Ink");
    v.restore();
  });
});
