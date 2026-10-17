// IMGGEN-SET-01: the Pictures and videos settings view.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { PicturesLibrary } from "@/apps/settings/PicturesLibrary";
import { likenessApi } from "@/lib/likenessApi";
import { picturesAdminApi, type AdminAdapter, type AdminOverview } from "@/lib/picturesApi";

afterEach(cleanup);

const style = (over: Partial<AdminAdapter> = {}): AdminAdapter => ({ id: "lora-a", name: "Pixel Art", base_model: "flux2-klein-4b", classification: "all-ages", classification_note: null, licence: "Apache-2.0", licence_known: true, source_url: null, bytes: 120_000_000, sha256: "a".repeat(64), trigger_words: ["pixelart"], added_at: "2026-10-17", enabled: true, needs_confirmation: false, ...over });
const overview = (over: Partial<AdminOverview> = {}): AdminOverview => ({
  stack: "ok",
  engine: { state: "idle", available: true, reason: null, default_model: "flux2-klein-4b", edit_ready: true, models: [{ id: "flux2-klein-4b", label: "FLUX.2 Klein 4B", installed: true, available: true, licence: "Apache-2.0", edit: true, peak_gb: 13.5, remaining_bytes: 0 }], remaining_bytes: 0 },
  adapters: [style(), style({ id: "lora-b", name: "Boudoir Film", classification: "adult-only", licence: "No licence stated", licence_known: false })],
  bands: [{ band: "children", label: "Children", on: false, locked: true, note: "Children cannot make pictures." }, { band: "teens", label: "Teens", on: false, locked: true, note: "Teens cannot make pictures." }, { band: "adults", label: "Adults", on: true, locked: false, note: "Adults can ask chat for pictures on their own screen." }],
  adult_adapters: "allowed",
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
  const view = renderWithQueryClient(<PicturesLibrary />);
  return { ...view, restore: () => Object.assign(picturesAdminApi, original) };
}

describe("Pictures and videos settings view", () => {
  test("shows the model, the three ages with children and teens locked off, and each style with its age badge and licence", async () => {
    const v = mount(overview());
    await waitFor(() => expect(v.getByText("FLUX.2 Klein 4B")).toBeTruthy());
    expect(v.getByLabelText("Children can make pictures")).toBeDisabled();
    expect(v.getByLabelText("Teens can make pictures")).toBeDisabled();
    expect(v.getByLabelText("Adults can make pictures").getAttribute("aria-checked")).toBe("true");
    expect(v.getByText("Pixel Art")).toBeTruthy();
    expect(v.getByText("Adults only")).toBeTruthy();
    expect(v.getByText("All ages")).toBeTruthy();
    expect(v.getAllByText(/No licence stated/).length).toBeGreaterThan(0);
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

  test("the add form needs the answer to 'Who does this style look like?', then sends it and not sure as unsure", async () => {
    const original = { ...likenessApi };
    likenessApi.adults = mock(async () => [{ id: "p-marlow", name: "Marlow", self: false, agreed: true }, { id: "p-nadia", name: "Nadia", self: false, agreed: false }]);
    const v = mount(overview({ adapters: [] }));
    await waitFor(() => expect(v.getByLabelText("Name")).toBeTruthy());
    fireEvent.change(v.getByLabelText("Name"), { target: { value: "Ink Wash" } });
    fireEvent.change(v.getByLabelText("Link to the .safetensors file"), { target: { value: "https://huggingface.co/x/y/resolve/main/a.safetensors" } });
    // Nothing is sent until the question is answered.
    expect(v.getByRole("button", { name: "Add style" })).toBeDisabled();
    fireEvent.click(v.getByRole("combobox", { name: "Who does this style look like?" }));
    fireEvent.click(await v.findByRole("option", { name: "Nobody (not a real person)" }));
    await waitFor(() => expect(v.getByRole("button", { name: "Add style" })).not.toBeDisabled());
    fireEvent.click(v.getByRole("button", { name: "Add style" }));
    await waitFor(() => expect(picturesAdminApi.addAdapter).toHaveBeenCalled());
    const sent = (picturesAdminApi.addAdapter as unknown as { mock: { calls: Array<[FormData]> } }).mock.calls[0]![0];
    expect(sent.get("all_ages")).toBe("unsure");
    expect(sent.get("looks_like")).toBe("nobody");
    Object.assign(likenessApi, original);
    v.restore();
  });

  test("an adult who has not agreed is listed but cannot be picked", async () => {
    const original = { ...likenessApi };
    likenessApi.adults = mock(async () => [{ id: "p-marlow", name: "Marlow", self: false, agreed: true }, { id: "p-nadia", name: "Nadia", self: false, agreed: false }]);
    const v = mount(overview({ adapters: [] }));
    await waitFor(() => expect(v.getByLabelText("Name")).toBeTruthy());
    fireEvent.click(v.getByRole("combobox", { name: "Who does this style look like?" }));
    const agreed = await v.findByRole("option", { name: "Marlow" });
    expect(agreed.getAttribute("aria-disabled")).not.toBe("true");
    expect((await v.findByRole("option", { name: "Nadia (has not agreed)" })).getAttribute("aria-disabled")).toBe("true");
    Object.assign(likenessApi, original);
    v.restore();
  });

  test("an engine that is not answering says so in plain words", async () => {
    const v = mount(overview({ stack: "unreachable", adapters: [] }));
    await waitFor(() => expect(v.getByText("The picture engine isn't answering")).toBeTruthy());
    v.restore();
  });
});
