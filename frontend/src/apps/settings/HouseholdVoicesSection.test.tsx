import { afterEach, describe, expect, test, mock, spyOn } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { householdVoicesApi, type HouseholdVoice } from "@/lib/householdVoicesApi";
import { voicePreviewPlayer } from "@/lib/voice/voicePreviewPlayer";
import { HouseholdVoicesSection } from "@/apps/settings/HouseholdVoicesSection";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(() => { cleanup(); mock.restore(); });

const voice = (id: string, more: Partial<HouseholdVoice> = {}): HouseholdVoice => ({ id, label: id, creatorId: "creator", creatorName: "Taylor", bytes: 10, createdAt: "", ...more });
function renderSection(voices: HouseholdVoice[] = []) {
  spyOn(householdVoicesApi, "list").mockResolvedValue({ voices });
  return renderWithQueryClient(<HouseholdVoicesSection />);
}

describe("HouseholdVoicesSection", () => {
  test("lists voices and optional settings, omitting defaults", async () => {
    const view = renderSection([
      voice("voice-one", { label: "Warm voice", creatorName: "Taylor", temperature: 1.2, pitchSemitones: -1 }),
      voice("voice-two", { label: "Clear voice", creatorName: "Morgan", pitchSemitones: 0 }),
    ]);
    await view.findByText("Warm voice");
    view.getByText("Made by Taylor · Liveliness 1.2 · Pitch -1 semitones");
    view.getByText("Clear voice");
    view.getByText("Made by Morgan");
    expect(view.queryByText("Pitch 0 semitones")).toBeNull();
  });

  test("empty list shows its plain empty state", async () => {
    const view = renderSection();
    await view.findByText("No voices made yet.");
  });

  test("requires a name and file, then sends the numbers as numbers", async () => {
    const make = spyOn(householdVoicesApi, "make").mockResolvedValue(voice("new", { label: "New voice" }));
    const view = renderSection();
    const button = await view.findByRole("button", { name: "Make voice" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(view.getByLabelText("Name"), { target: { value: "New voice" } });
    expect(button.disabled).toBe(true);
    const clip = new File(["audio"], "clip.wav", { type: "audio/wav" });
    fireEvent.change(view.getByLabelText("Recording"), { target: { files: [clip] } });
    expect(button.disabled).toBe(false);
    fireEvent.change(view.getByLabelText("Liveliness (optional)"), { target: { value: "1.05" } });
    fireEvent.change(view.getByLabelText("Pitch (optional)"), { target: { value: "-1" } });
    fireEvent.submit(button.closest("form")!);
    await waitFor(() => expect(make).toHaveBeenCalledWith({ name: "New voice", clip, temperature: 1.05, pitchSemitones: -1 }));
  });

  test("blank number fields are passed as undefined", async () => {
    const make = spyOn(householdVoicesApi, "make").mockResolvedValue(voice("new", { label: "New voice" }));
    const view = renderSection();
    fireEvent.change(await view.findByLabelText("Name"), { target: { value: "New voice" } });
    const clip = new File(["audio"], "clip.wav", { type: "audio/wav" });
    fireEvent.change(view.getByLabelText("Recording"), { target: { files: [clip] } });
    fireEvent.submit(view.getByRole("button", { name: "Make voice" }).closest("form")!);
    await waitFor(() => expect(make).toHaveBeenCalledWith({ name: "New voice", clip, temperature: undefined, pitchSemitones: undefined }));
  });

  test("success confirms and clears the form", async () => {
    spyOn(householdVoicesApi, "make").mockResolvedValue(voice("new", { label: "Home voice" }));
    const view = renderSection();
    const name = await view.findByLabelText("Name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Home voice" } });
    fireEvent.change(view.getByLabelText("Recording"), { target: { files: [new File(["audio"], "clip.wav", { type: "audio/wav" })] } });
    fireEvent.change(view.getByLabelText("Liveliness (optional)"), { target: { value: "1.1" } });
    fireEvent.change(view.getByLabelText("Pitch (optional)"), { target: { value: "2" } });
    fireEvent.submit(view.getByRole("button", { name: "Make voice" }).closest("form")!);
    await view.findByRole("status");
    expect(view.getByRole("status").textContent).toBe("Home voice is ready. Choose it in the list above or on a robot's page.");
    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("");
    expect((view.getByLabelText("Liveliness (optional)") as HTMLInputElement).value).toBe("");
    expect((view.getByLabelText("Pitch (optional)") as HTMLInputElement).value).toBe("");
    expect((view.getByLabelText("Recording") as HTMLInputElement).value).toBe("");
  });

  test("a rejected make shows the API message and keeps the name", async () => {
    spyOn(householdVoicesApi, "make").mockRejectedValue(new ApiError("The reference clip must be 6 to 30 seconds long; this one is 4.0 seconds.", 400));
    const view = renderSection();
    fireEvent.change(await view.findByLabelText("Name"), { target: { value: "Keep me" } });
    fireEvent.change(view.getByLabelText("Recording"), { target: { files: [new File(["audio"], "clip.wav", { type: "audio/wav" })] } });
    fireEvent.submit(view.getByRole("button", { name: "Make voice" }).closest("form")!);
    expect((await view.findByRole("alert")).textContent).toBe("The reference clip must be 6 to 30 seconds long; this one is 4.0 seconds.");
    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("Keep me");
  });

  test("shows the responsibility sentence without a checkbox", async () => {
    const view = renderSection();
    await view.findByText("You are responsible for having the right to use this voice.");
    expect(view.queryAllByRole("checkbox")).toHaveLength(0);
  });

  test("Delete removes the voice id", async () => {
    const remove = spyOn(householdVoicesApi, "remove").mockResolvedValue({ success: true });
    const view = renderSection([voice("voice-delete", { label: "To delete" })]);
    await view.findByText("To delete");
    fireEvent.click(view.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("voice-delete"));
  });

  test("Test toggles the shared preview player", async () => {
    const start = spyOn(voicePreviewPlayer, "start").mockImplementation(async (id: string) => { (voicePreviewPlayer as unknown as { update(s: unknown): void }).update({ voiceId: id, busy: false, error: null }); });
    const stop = spyOn(voicePreviewPlayer, "stop");
    const view = renderSection([voice("voice-test", { label: "Try me" })]);
    fireEvent.click(await view.findByRole("button", { name: "Test" }));
    expect(start).toHaveBeenCalledWith("voice-test");
    fireEvent.click(await view.findByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalled();
  });
});
