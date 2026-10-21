import { afterEach, describe, expect, test, mock, spyOn } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { api, ApiError, type ResolvedSetting, type StackVoice } from "@/lib/api";
import { householdVoicesApi, type HouseholdVoice } from "@/lib/householdVoicesApi";
import { voicePreviewPlayer } from "@/lib/voice/voicePreviewPlayer";
import { VoiceManagerSection } from "@/apps/settings/VoiceManagerSection";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(() => { cleanup(); mock.restore(); });

const stackVoice = (id: string, more: Partial<StackVoice> = {}): StackVoice => ({ id, name: id, description: "unknown", language: "en", country: "US", gender: "female", source: "preset", engine: "chatterbox-turbo", onDisk: true, licence: null, revision: "r", ...more });
const made = (id: string, more: Partial<HouseholdVoice> = {}): HouseholdVoice => ({ id, label: id, creatorId: "p", creatorName: "Sage", bytes: 10, createdAt: "", ...more });
const setting = (value: unknown): ResolvedSetting => ({ key: "tts.home_voice", value, source: "user", label: "Home's default voice", level: "basic", secret: false } as ResolvedSetting);

function render(voices: StackVoice[], household: HouseholdVoice[] = [], home: unknown = "default") {
  spyOn(api, "stackVoices").mockResolvedValue({ voices });
  spyOn(householdVoicesApi, "list").mockResolvedValue({ voices: household });
  spyOn(api, "settingsValues").mockResolvedValue([setting(home)]);
  return renderWithQueryClient(<VoiceManagerSection />);
}
const builtIn = stackVoice("chatterbox-turbo-voice-default", { name: "Chatterbox default", gender: "unknown" });
const cutey = stackVoice("voice-cutey1234", { name: "Cutey", source: "cloned", gender: "unknown" });

describe("VoiceManagerSection", () => {
  test("lists each voice with its source, gender and language, and never calls a voice 'Default voice'", async () => {
    const view = render([builtIn, cutey, stackVoice("vera", { name: "Vera", gender: "female" })], [made("voice-cutey1234", { label: "Cutey", temperature: 1.05, pitchSemitones: -1 })]);
    await view.findByText("Cutey");
    expect(view.getByText("Built-in voice")).toBeTruthy();
    expect(view.getByText("Vera")).toBeTruthy();
    expect(view.getAllByText("Custom").length).toBeGreaterThan(0);
    expect(view.getAllByText("Built in").length).toBeGreaterThan(0);
    expect(view.getAllByText("Female").length).toBeGreaterThan(0);
    expect(view.getAllByText("English").length).toBeGreaterThan(0);
    view.getByText("Made by Sage · Liveliness 1.05 · Pitch -1");
    expect(view.queryByText("Default voice")).toBeNull();
  });

  test("the voice that is Home's default carries a badge and no Set as default button; the others offer it", async () => {
    const view = render([builtIn, cutey], [made("voice-cutey1234", { label: "Cutey" })], "voice-cutey1234");
    await view.findByText("Cutey");
    expect(view.getAllByText("Home's default")).toHaveLength(1);
    const cuteyRow = view.getByText("Cutey").closest("li")!;
    expect(within(cuteyRow).queryByRole("button", { name: "Set as default" })).toBeNull();
    const builtInRow = view.getByText("Built-in voice").closest("li")!;
    expect(within(builtInRow).getByRole("button", { name: "Set as default" })).toBeTruthy();
  });

  test("Set as default saves the household setting, and the engine's own voice is saved as 'default'", async () => {
    const view = render([builtIn, cutey], [made("voice-cutey1234", { label: "Cutey" })], "voice-cutey1234");
    const save = spyOn(api, "setSetting").mockImplementation(async (_scope: string, _key: string, value: unknown) => setting(value) as never);
    await view.findByText("Cutey");
    fireEvent.click(within(view.getByText("Built-in voice").closest("li")!).getByRole("button", { name: "Set as default" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("household", "tts.home_voice", "default"));
    await view.findByText("Built-in voice is now Home's default voice.");
  });

  test("only a custom voice can be deleted, after a confirmation", async () => {
    const view = render([builtIn, cutey], [made("voice-cutey1234", { label: "Cutey" })]);
    const remove = spyOn(householdVoicesApi, "remove").mockResolvedValue({ success: true });
    await view.findByText("Cutey");
    expect(within(view.getByText("Built-in voice").closest("li")!).queryByRole("button", { name: "Delete" })).toBeNull();
    fireEvent.click(within(view.getByText("Cutey").closest("li")!).getByRole("button", { name: "Delete" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(await view.findByRole("button", { name: "Delete voice" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("voice-cutey1234"));
  });

  test("a custom voice can be renamed; a built-in voice has no Rename", async () => {
    const view = render([builtIn, cutey], [made("voice-cutey1234", { label: "Cutey" })]);
    const rename = spyOn(householdVoicesApi, "rename").mockResolvedValue(made("voice-cutey1234", { label: "Bee-Mo" }));
    await view.findByText("Cutey");
    expect(within(view.getByText("Built-in voice").closest("li")!).queryByRole("button", { name: "Rename" })).toBeNull();
    fireEvent.click(within(view.getByText("Cutey").closest("li")!).getByRole("button", { name: "Rename" }));
    const dialog = await view.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Voice name"), { target: { value: "Bee-Mo" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith("voice-cutey1234", "Bee-Mo"));
    await view.findByText("The voice is now called Bee-Mo.");
  });

  test("Test plays the shared preview player", async () => {
    const start = spyOn(voicePreviewPlayer, "start").mockResolvedValue(undefined as never);
    const view = render([builtIn]);
    fireEvent.click(await view.findByRole("button", { name: "Test" }));
    expect(start).toHaveBeenCalledWith("chatterbox-turbo-voice-default");
  });

  test("Add voice opens a dialog: Make voice needs a name and a recording, then sends the numbers as numbers", async () => {
    const make = spyOn(householdVoicesApi, "make").mockResolvedValue(made("voice-new", { label: "Fresh" }));
    const view = render([builtIn]);
    fireEvent.click(await view.findByRole("button", { name: "Add voice" }));
    const dialog = await view.findByRole("dialog");
    const button = within(dialog).getByRole("button", { name: "Make voice" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Fresh" } });
    const clip = new File(["audio"], "clip.wav", { type: "audio/wav" });
    fireEvent.change(within(dialog).getByLabelText("Recording"), { target: { files: [clip] } });
    expect(button.disabled).toBe(false);
    fireEvent.change(within(dialog).getByLabelText("Liveliness (optional)"), { target: { value: "1.05" } });
    fireEvent.change(within(dialog).getByLabelText("Pitch (optional)"), { target: { value: "-1" } });
    fireEvent.submit(document.getElementById("add-voice-form")!);
    await waitFor(() => expect(make).toHaveBeenCalledWith({ name: "Fresh", clip, temperature: 1.05, pitchSemitones: -1 }));
    await view.findByText("Fresh is ready. Test it here, then pick it for a person or a robot.");
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  });

  test("a refused recording shows the reason inside the dialog and keeps what was typed", async () => {
    spyOn(householdVoicesApi, "make").mockRejectedValue(new ApiError("The reference recording must be 6 to 30 seconds long; this one is 4.0 seconds.", 400));
    const view = render([builtIn]);
    fireEvent.click(await view.findByRole("button", { name: "Add voice" }));
    const dialog = await view.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Keep me" } });
    fireEvent.change(within(dialog).getByLabelText("Recording"), { target: { files: [new File(["a"], "c.wav", { type: "audio/wav" })] } });
    fireEvent.submit(document.getElementById("add-voice-form")!);
    expect((await within(dialog).findByRole("alert")).textContent).toContain("6 to 30 seconds");
    expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value).toBe("Keep me");
  });

  test("the dialog states the responsibility sentence without a checkbox", async () => {
    const view = render([builtIn]);
    fireEvent.click(await view.findByRole("button", { name: "Add voice" }));
    const dialog = await view.findByRole("dialog");
    within(dialog).getByText("You are responsible for having the right to use this voice.");
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
  });
});
