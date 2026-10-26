// IMGGEN-SET-01: the Pictures and videos settings view.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { PicturesLibrary } from "@/apps/settings/PicturesLibrary";
import { picturesAdminApi, type AdminAdapter, type AdminOverview } from "@/lib/picturesApi";

afterEach(cleanup);

const style = (over: Partial<AdminAdapter> = {}): AdminAdapter => ({ id: "lora-a", name: "Pixel Art", base_model: "flux2-klein-4b", classification: "all-ages", classification_note: null, licence: "Apache-2.0", licence_known: true, source_url: null, bytes: 120_000_000, sha256: "a".repeat(64), trigger_words: ["pixelart"], added_at: "2026-10-17", enabled: true, needs_confirmation: false, ...over });
const overview = (over: Partial<AdminOverview> = {}): AdminOverview => ({
  stack: "ok",
  engine: { state: "idle", available: true, reason: null, default_model: "flux2-klein-4b", edit_ready: true, models: [{ id: "flux2-klein-4b", label: "FLUX.2 Klein 4B", installed: true, available: true, licence: "Apache-2.0", edit: true, peak_gb: 13.5, remaining_bytes: 0 }], remaining_bytes: 0 },
  adapters: [style(), style({ id: "lora-b", name: "Boudoir Film", classification: "adult-only", licence: "No licence stated", licence_known: false })],
  bands: [{ band: "children", label: "Children", on: false, locked: true, note: "Children cannot make pictures." }, { band: "teens", label: "Teens", on: false, locked: true, note: "Teens cannot make pictures." }, { band: "adults", label: "Adults", on: true, locked: false, note: "Adults can ask chat for pictures on their own screen." }],
  adult_adapters: "allowed",
  quality: "quick",
  detailed_ready: false,
  ...over,
});
function mount(data: AdminOverview) {
  const original = { ...picturesAdminApi };
  picturesAdminApi.overview = mock(async () => data);
  picturesAdminApi.setEnabled = mock(async (id: string, enabled: boolean) => ({ ...style({ id }), enabled }));
  picturesAdminApi.remove = mock(async () => ({ ok: true as const }));
  picturesAdminApi.installModel = mock(async () => ({ job: "j1", family: "flux2-klein-4b" }));
  picturesAdminApi.job = mock(async () => ({ state: "running" as const, percent: 30, label: "x", error: null, code: null, adapter: null }));
  picturesAdminApi.addAdapter = mock(async () => ({ adapter: style({ id: "lora-new", name: "Ink Wash", enabled: false, needs_confirmation: true }) }));
  const view = renderWithQueryClient(<MemoryRouter><PicturesLibrary /></MemoryRouter>);
  return { ...view, restore: () => Object.assign(picturesAdminApi, original) };
}

describe("Pictures and videos settings view", () => {

  test("shows the model, the three ages with children and teens locked off, and each style with its age badge and licence", async () => {
    const v = mount(overview());
    await waitFor(() => expect(v.getByText("Quick")).toBeTruthy());
    expect(v.queryByText("FLUX.2 Klein 4B")).toBeNull();
    expect(v.getByLabelText("Children can make pictures")).toBeDisabled();
    expect(v.getByLabelText("Teens can make pictures")).toBeDisabled();
    expect(v.getByLabelText("Adults can make pictures").getAttribute("aria-checked")).toBe("true");
    expect(v.getByText("Pixel Art")).toBeTruthy();
    expect(v.getByText("Adults only")).toBeTruthy();
    expect(v.getByText("All ages")).toBeTruthy();
    expect(v.getAllByText(/No licence stated/).length).toBeGreaterThan(0);
    v.restore();
  });

  test("IMGGEN-QUALITY-01: Quick and Detailed in plain words, the difference and the model names only when opened, and Get Detailed pictures with its size", async () => {
    const detailed = { id: "z-image-turbo", label: "Z-Image-Turbo", installed: false, available: true, licence: "Apache-2.0", edit: false, peak_gb: 34, remaining_bytes: 32_800_000_000 };
    const base = overview();
    const v = mount(overview({ engine: { ...base.engine, models: [...base.engine.models, detailed] }, quality: "detailed", detailed_ready: false }));
    await waitFor(() => expect(v.getByText("Detailed")).toBeTruthy());
    expect(v.queryByText(/Z-Image/)).toBeNull();
    expect(v.getByText("Detailed is chosen, but it is not ready")).toBeTruthy();
    fireEvent.click(v.getByRole("button", { name: "What is the difference?" }));
    await waitFor(() => expect(v.getByRole("table", { name: "Quick compared with Detailed" })).toBeTruthy());
    expect(v.getByText("About 30 to 45 seconds")).toBeTruthy();
    fireEvent.click(v.getByRole("button", { name: "Details" }));
    await waitFor(() => expect(v.getByText("FLUX.2 Klein 4B")).toBeTruthy());
    fireEvent.click(v.getByRole("button", { name: "Get Detailed pictures (32.8 GB)" }));
    await waitFor(() => expect(picturesAdminApi.installModel).toHaveBeenCalledWith("z-image-turbo"));
    v.restore();
  });

  test("Detailed already on this computer shows no download button and no warning", async () => {
    const base = overview();
    const v = mount(overview({ engine: { ...base.engine, models: [...base.engine.models, { id: "z-image-turbo", label: "Z-Image-Turbo", installed: true, available: true, licence: "Apache-2.0", edit: false, peak_gb: 34, remaining_bytes: 0 }] }, detailed_ready: true }));
    await waitFor(() => expect(v.getByText("Detailed")).toBeTruthy());
    expect(v.queryByRole("button", { name: /Get Detailed pictures/ })).toBeNull();
    expect(v.queryByText("Detailed is chosen, but it is not ready")).toBeNull();
    v.restore();
  });

  test("a style's switch calls the household switch and a new style waits for a confirmation showing its fingerprint", async () => {
    const v = mount(overview({ adapters: [style({ id: "lora-new", name: "Ink Wash", enabled: false, needs_confirmation: true, sha256: "f".repeat(64) })] }));
    await waitFor(() => expect(v.getByText("Check this before you turn it on")).toBeTruthy());
    expect(v.getByText("f".repeat(64))).toBeTruthy();
    fireEvent.click(v.getByRole("button", { name: "Turn it on" }));
    await waitFor(() => expect(picturesAdminApi.setEnabled).toHaveBeenCalledWith("lora-new", true));
    v.restore();
  });

  test("with no picture model installed it offers the install and says the size", async () => {
    const v = mount(overview({ engine: { state: "not-installed", available: true, reason: null, default_model: null, edit_ready: false, models: [], remaining_bytes: 13_500_000_000 }, adapters: [] }));
    await waitFor(() => expect(v.getByText("No picture model is installed")).toBeTruthy());
    expect(v.getByText(/13.5 GB/)).toBeTruthy();
    fireEvent.click(v.getByRole("button", { name: "Install the picture model" }));
    await waitFor(() => expect(picturesAdminApi.installModel).toHaveBeenCalled());
    v.restore();
  });


  test("a big style file already on this computer is added by its path, with no link and no upload", async () => {
    const v = mount(overview({ adapters: [] }));
    await waitFor(() => expect(v.getByLabelText("Name")).toBeTruthy());
    fireEvent.change(v.getByLabelText("Name"), { target: { value: "Ink Wash" } });
    fireEvent.click(v.getByRole("radio", { name: "A file already on this computer (for big files)" }));
    fireEvent.change(v.getByLabelText("Where the .safetensors file is saved on this computer"), { target: { value: " /Users/you/Downloads/ink.safetensors " } });
    await waitFor(() => expect(v.getByRole("button", { name: "Add style" })).not.toBeDisabled());
    fireEvent.click(v.getByRole("button", { name: "Add style" }));
    await waitFor(() => expect(picturesAdminApi.addAdapter).toHaveBeenCalled());
    const sent = (picturesAdminApi.addAdapter as unknown as { mock: { calls: Array<[FormData]> } }).mock.calls[0]![0];
    expect(sent.get("path")).toBe("/Users/you/Downloads/ink.safetensors");
    expect(sent.get("url")).toBeNull();
    expect(sent.get("file")).toBeNull();
    v.restore();
  });

  test("an engine that is not answering says so in plain words", async () => {
    const v = mount(overview({ stack: "unreachable", adapters: [] }));
    await waitFor(() => expect(v.getByText("The picture engine isn't answering")).toBeTruthy());
    v.restore();
  });
});
