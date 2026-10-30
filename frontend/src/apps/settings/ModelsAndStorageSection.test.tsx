// COMPONENTS-01: Settings, Models and storage.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ModelsAndStorageSection, lastUsedWords, sizeWords } from "@/apps/settings/ModelsAndStorageSection";
import { componentsApi, type ComponentRow, type ComponentsOverview, type LicenceOverview } from "@/lib/componentsApi";
import { ApiError } from "@/lib/api";

afterEach(() => { cleanup(); licenceData = { stack: "ok", terms_version: "v", acknowledged: { by: "p", at: "t", terms_version: "v" }, needs_prompt: false, licences: [], extras: null }; });

const row = (over: Partial<ComponentRow>): ComponentRow => ({
  id: "z-image-turbo", label: "Pictures: Z-Image-Turbo", summary: "A higher-detail picture model for the largest computers.", group: "pictures", kind: "model", state: "notInstalled",
  size_bytes: null, download_bytes: 33_948_304_893, full_bytes: 33_948_304_893, required_free_bytes: 36_000_000_000, plan_need: "optional", requirement: "optional", requirement_reason: null,
  last_used_at: null, used_by: [], depends_on: [], job: null, percent: null, failure: null, can_install: true, install_block: null, can_uninstall: false, uninstall_block: "It is not installed.", ...over,
});
const overview = (rows: ComponentRow[], over: Partial<ComponentsOverview> = {}): ComponentsOverview => ({ stack: "ok", message: null, tier: "p128", free_disk_bytes: 1_500_000_000_000, disk_margin_bytes: 5e9, installed_bytes: 90_000_000_000, components: rows, ...over });

let licenceData: LicenceOverview = { stack: "ok", terms_version: "v", acknowledged: { by: "p", at: "t", terms_version: "v" }, needs_prompt: false, licences: [], extras: null };
function mount(data: ComponentsOverview) {
  const original = { ...componentsApi };
  componentsApi.list = mock(async () => data);
  componentsApi.licences = mock(async () => licenceData);
  componentsApi.acceptLicences = mock(async () => ({ accepted: true as const, auto_install: false }));
  componentsApi.installExtras = mock(async () => ({ started: true as const, models: 1 }));
  componentsApi.install = mock(async (id: string) => ({ job: "j1", component: id }));
  componentsApi.uninstall = mock(async (id: string) => ({ component: id, freed_bytes: 41_000_000_000, removed: true }));
  const view = renderWithQueryClient(<ModelsAndStorageSection />);
  return { ...view, restore: () => Object.assign(componentsApi, original) };
}

describe("words", () => {
  test("sizes and last use", () => {
    expect(sizeWords(33_948_304_893)).toBe("34 GB");
    expect(sizeWords(2_500_000_000)).toBe("2.5 GB");
    expect(sizeWords(400_000_000)).toBe("400 MB");
    expect(sizeWords(1_500_000_000_000)).toBe("1.5 TB");
    const now = Date.parse("2026-10-17T12:00:00Z");
    expect(lastUsedWords(null, now)).toBe("Not used yet");
    expect(lastUsedWords("2026-10-17T01:00:00Z", now)).toBe("Used today");
    expect(lastUsedWords("2026-09-26T12:00:00Z", now)).toBe("Used 3 weeks ago");
    expect(lastUsedWords("2026-05-01T12:00:00Z", now)).toBe("Used 5 months ago");
  });
});

describe("Models and storage", () => {
  test("the music maker is listed under its own Music heading", async () => {
    const v = mount(overview([
      row({ id: "music", label: "Music: ACE-Step 1.5", summary: "Writes and sings songs on this computer.", group: "music", download_bytes: 11_460_000_000 }),
      row({}),
    ]));
    await waitFor(() => expect(v.getByRole("heading", { name: "Music" })).toBeTruthy());
    const heading = v.getByRole("heading", { name: "Music" });
    expect(heading.parentElement?.textContent ?? "").toContain("Music: ACE-Step 1.5");
    expect(v.getByTestId("component-music").textContent).toContain("Download about 11 GB");
    expect(v.getByRole("heading", { name: "Pictures" })).toBeTruthy();
    v.restore();
  });

  test("lists the parts by group with size, state, last use and the room left", async () => {
    const v = mount(overview([
      row({}),
      row({ id: "muse", label: "Chat model: Muse Glimmer 30B", group: "chat", state: "installed", size_bytes: 21_000_000_000, requirement: "required", can_install: false, can_uninstall: false, uninstall_block: "Chat is using this model. Pick another chat model first, then remove this one.", last_used_at: new Date().toISOString(), used_by: ["Chat"] }),
    ]));
    await waitFor(() => expect(v.getByText("Pictures: Z-Image-Turbo")).toBeTruthy());
    expect(v.getByText(/90 GB of AI on this computer, 1\.5 TB free/)).toBeTruthy();
    expect(v.getByRole("heading", { name: "Chat and thinking" })).toBeTruthy();
    expect(v.getByRole("heading", { name: "Pictures" })).toBeTruthy();
    expect(v.getByTestId("component-z-image-turbo").textContent).toContain("Download about 34 GB");
    const muse = v.getByTestId("component-muse");
    expect(muse.textContent).toContain("Uses 21 GB");
    expect(muse.textContent).toContain("Used today");
    expect(muse.textContent).toContain("Used by: Chat");
    // The chat model chat is using cannot be removed: the button is off and the plain reason shows.
    expect(v.getByLabelText("Uninstall Chat model: Muse Glimmer 30B")).toBeDisabled();
    expect(muse.textContent).toContain("Chat is using this model. Pick another chat model first, then remove this one.");
    v.restore();
  });

  test("Install starts the install and the list reloads", async () => {
    const v = mount(overview([row({})]));
    fireEvent.click(await v.findByLabelText("Install Pictures: Z-Image-Turbo"));
    await waitFor(() => expect(componentsApi.install).toHaveBeenCalledWith("z-image-turbo", undefined));
    await waitFor(() => expect((componentsApi.list as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(1));
    v.restore();
  });

  test("Detailed video that an upgrade did not pull reads \"Recommended, not installed\" with an Install button, and nothing starts by itself", async () => {
    const v = mount(overview([row({ id: "ltx-2-3-distilled-mlx", label: "Video: Detailed (LTX-2.3)", group: "video", plan_need: "recommended", download_bytes: 73_600_000_000, full_bytes: 73_600_000_000 })]));
    expect(await v.findByText("Recommended, not installed")).toBeTruthy();
    expect(v.getByLabelText("Install Video: Detailed (LTX-2.3)")).toBeTruthy();
    expect((componentsApi.install as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    v.restore();
  });

  test("a part with a licence of its own asks once: the points are shown, nothing installs until I accept, then it installs with that licence", async () => {
    const licence = { id: "ltx-2.x-community-2026-08-11", name: "LTX-2.x Community License Agreement (2026-08-11)", url: "https://example.com/licence", summary: ["Free under $10 million a year."], accepted_at: null };
    const v = mount(overview([row({ id: "ltx-2-3-distilled-mlx", label: "Video: Detailed (LTX-2.3)", licence })]));
    fireEvent.click(await v.findByLabelText("Install Video: Detailed (LTX-2.3)"));
    expect(await v.findByText("Free under $10 million a year.")).toBeTruthy();
    expect(componentsApi.install).not.toHaveBeenCalled();
    fireEvent.click(v.getByRole("button", { name: "I accept, get it" }));
    await waitFor(() => expect(componentsApi.install).toHaveBeenCalledWith("ltx-2-3-distilled-mlx", "ltx-2.x-community-2026-08-11"));
    v.restore();
  });

  test("a licence the household acknowledgement covers installs with one click and no dialog", async () => {
    const licence = { id: "ltx-2.x-community-2026-08-11", name: "LTX-2.x Community License Agreement (2026-08-11)", url: "https://example.com/licence", summary: ["Free under $10 million a year."], accepted_at: null, covered: true };
    const v = mount(overview([row({ id: "ltx-2-3-distilled-mlx", label: "Video: Detailed (LTX-2.3)", licence })]));
    fireEvent.click(await v.findByLabelText("Install Video: Detailed (LTX-2.3)"));
    await waitFor(() => expect(componentsApi.install).toHaveBeenCalledWith("ltx-2-3-distilled-mlx", undefined));
    expect(v.queryByRole("button", { name: "I accept, get it" })).toBeNull();
    v.restore();
  });

  test("no acknowledgement: one prompt, it opens the licence list, one Accept records it and the prompt goes away", async () => {
    licenceData = { stack: "ok", terms_version: "v", acknowledged: null, needs_prompt: true, extras: null, licences: [{ component: "ltx-2-3-distilled-mlx", label: "Video: Detailed (LTX-2.3)", id: "ltx", name: "LTX licence", url: "https://example.com/licence", summary: ["Free under $10 million a year."], accepted_at: null, covered: false }] };
    const v = mount(overview([]));
    expect(await v.findByText("Accept the licences for the AI models Home installs")).toBeTruthy();
    fireEvent.click(v.getByRole("button", { name: "See the licences" }));
    expect(await v.findByText("Free under $10 million a year.")).toBeTruthy();
    expect(componentsApi.acceptLicences).not.toHaveBeenCalled();
    licenceData = { ...licenceData, acknowledged: { by: "p", at: "t", terms_version: "v" }, needs_prompt: false };
    fireEvent.click(v.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(componentsApi.acceptLicences).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(v.queryByTestId("licence-prompt")).toBeNull());
    expect(componentsApi.installExtras).not.toHaveBeenCalled();
    v.restore();
  });

  test("after the accept the extras are one explicit button with the size, never started by themselves", async () => {
    licenceData = { stack: "ok", terms_version: "v", acknowledged: { by: "p", at: "t", terms_version: "v" }, needs_prompt: false, licences: [], extras: { ids: ["video-detailed"], labels: ["Detailed videos"], bytes: 74e9, size: "74 GB" } };
    const v = mount(overview([]));
    expect(componentsApi.installExtras).not.toHaveBeenCalled();
    fireEvent.click(await v.findByRole("button", { name: "Install the recommended extras (74 GB)" }));
    await waitFor(() => expect(componentsApi.installExtras).toHaveBeenCalledTimes(1));
    v.restore();
  });

  test("a part that does not fit is off, and says how much room it needs and what is free", async () => {
    const block = "Not enough room: it needs about 36 GB and this computer has 20 GB free. Free some space first.";
    const v = mount(overview([row({ can_install: false, install_block: block })]));
    const button = await v.findByLabelText("Install Pictures: Z-Image-Turbo");
    expect(button).toBeDisabled();
    expect(v.getByText(block)).toBeTruthy();
    v.restore();
  });

  test("a part this computer cannot run is off with the reason", async () => {
    const reason = "This needs a computer with more memory than this one.";
    const v = mount(overview([row({ requirement: "unsupported", requirement_reason: reason, can_install: false, install_block: reason })], { tier: "p32" }));
    await waitFor(() => expect(v.getByText("Not for this computer")).toBeTruthy());
    expect(v.getByLabelText("Install Pictures: Z-Image-Turbo")).toBeDisabled();
    expect(v.getByText(reason)).toBeTruthy();
    v.restore();
  });

  test("Uninstall asks first: it says what it frees and that it can come back, and only then removes", async () => {
    const v = mount(overview([row({ state: "installed", size_bytes: 41_000_000_000, can_install: false, can_uninstall: true, uninstall_block: null })]));
    fireEvent.click(await v.findByLabelText("Uninstall Pictures: Z-Image-Turbo"));
    expect(await v.findByText("This frees 41 GB. You can install it again later.")).toBeTruthy();
    expect(componentsApi.uninstall).not.toHaveBeenCalled();
    fireEvent.click(v.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(v.queryByText("This frees 41 GB. You can install it again later.")).toBeNull(), { timeout: 5000 });
    expect(componentsApi.uninstall).not.toHaveBeenCalled();
    fireEvent.click(v.getByLabelText("Uninstall Pictures: Z-Image-Turbo"));
    fireEvent.click(await v.findByRole("button", { name: "Uninstall" }));
    await waitFor(() => expect(componentsApi.uninstall).toHaveBeenCalledWith("z-image-turbo"));
    v.restore();
  }, 20_000);

  test("an installing part shows its progress card and no buttons; a failed one says why and offers Try again", async () => {
    const v = mount(overview([
      row({ state: "installing", percent: 42, job: "j1", can_install: false }),
      row({ id: "video", label: "Video: Wan 2.2", group: "video", state: "failed", failure: "The connection dropped.", can_install: true }),
    ]));
    const bar = await v.findByLabelText("Pictures: Z-Image-Turbo progress");
    expect(bar).toBeTruthy();
    expect(v.queryByLabelText("Install Pictures: Z-Image-Turbo")).toBeNull();
    expect(v.getByText("The connection dropped.")).toBeTruthy();
    expect(v.getByLabelText("Try again: Video: Wan 2.2")).toBeEnabled();
    v.restore();
  });

  test("the Stack's refusal shows as its own sentence", async () => {
    const v = mount(overview([row({ state: "installed", size_bytes: 1e9, can_install: false, can_uninstall: true, uninstall_block: null })]));
    componentsApi.uninstall = mock(async () => { throw new ApiError("A picture is being made right now. Try again when it finishes.", 409, "in_use"); });
    fireEvent.click(await v.findByLabelText("Uninstall Pictures: Z-Image-Turbo"));
    fireEvent.click(await v.findByRole("button", { name: "Uninstall" }));
    expect(await v.findByText("A picture is being made right now. Try again when it finishes.")).toBeTruthy();
    v.restore();
  });

  test("with the engine down it says so instead of an empty page", async () => {
    const v = mount(overview([], { stack: "unreachable", message: "The engine isn't answering. Check that the engine is running, then try again." }));
    expect(await v.findByText("The AI engine isn't answering")).toBeTruthy();
    expect(v.getByText("The engine isn't answering. Check that the engine is running, then try again.")).toBeTruthy();
    v.restore();
  });
});
