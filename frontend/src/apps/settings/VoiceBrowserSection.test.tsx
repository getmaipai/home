import { afterEach, describe, expect, test, mock, spyOn } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { voicePreviewPlayer } from "@/lib/voice/voicePreviewPlayer";
import { VoiceBrowserSection } from "@/apps/settings/VoiceBrowserSection";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { StackVoice, Roster } from "@/lib/api";

const person = (role: Roster["role"] = "adult"): Roster => ({ id: "person-1", display_name: "Taylor", role, nickname: null, avatar_seed: "x", source: "hub", local_only: false, created_at: "", updated_at: "", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "", hasSecret: false } as Roster);
const voice = (id: string, more: Partial<StackVoice> = {}): StackVoice => ({ id, name: id, description: "unknown", language: "en", country: "US", gender: "female", source: "preset", engine: "engine-a", onDisk: true, licence: null, revision: "", ...more });

afterEach(() => { cleanup(); mock.restore(); });

class FakeAudioContext {
  currentTime = 0; destination = {};
  close() { return Promise.resolve(); }
  createBuffer() { return { duration: 0, getChannelData: () => new Float32Array(0) }; }
  createBufferSource() { return { buffer: null, connect() {}, start() {}, onended: null as (() => void) | null }; }
}
globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;

function renderPage(voices: StackVoice[], options = ["alba", "mira"], settings: Record<string, unknown> = {}) {
  spyOn(api, "stackVoices").mockResolvedValue({ voices });
  spyOn(api, "settingsRegistry").mockResolvedValue([{ key: "tts.voice_id", label: "Speaking voice", scope: "person", selector: "select", range: { options }, default: "alba", control: { child: "self", teen: "self", adult: "self" }, band_default: { child: "alba", teen: "alba", adult: "alba" }, copy: { does: "Sets speaking voice" } }] as never);
  const actor = { ...person((settings.role as Roster["role"] | undefined) ?? "adult"), id: "person-1" };
  spyOn(api, "people").mockResolvedValue([actor] as never);
  spyOn(api, "settingsValues").mockResolvedValue([{ key: "tts.voice_id", value: settings.voice ?? "alba", source: "default", label: "Speaking voice", level: "basic", secret: false, locked: settings.locked as boolean | undefined, reason: settings.reason as string | undefined }]);
  spyOn(api, "setSetting").mockResolvedValue({ key: "tts.voice_id", value: "alba", source: "user", label: "Speaking voice", level: "basic", secret: false });
  return renderWithQueryClient(<VoiceBrowserSection person={actor} />);
}

describe("VoiceBrowserSection", () => {
  test("lists plain names with no engine words, clone controls, filters or table", async () => {
    const view = renderPage([voice("pocket-tts-voice-alba", { name: "Alba", description: "Warm, friendly" }), voice("chatterbox-turbo-voice-default", { name: "Chatterbox default" })], ["alba"]);
    await view.findByText("Alba"); await view.findByText("Default"); await view.findByText("Warm, friendly");
    expect(view.getByText("Choose a voice for you")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/chatterbox|pocket|orpheus|mlx|clone|upload|unknown|catalog/i);
    expect(view.queryAllByRole("combobox")).toHaveLength(0);
  });
  test("only installed presets are listed", async () => {
    const view = renderPage([voice("x-voice-alba", { name: "Alba" }), voice("x-voice-mira", { name: "Mira", onDisk: false }), voice("c", { name: "Community", source: "community" }), voice("k", { name: "Cloned", source: "cloned" })]);
    await view.findByText("Alba");
    for (const name of ["Mira", "Community", "Cloned"]) expect(view.queryByText(name)).toBeNull();
  });
  test("the current voice is the checked radio; choosing another saves at once and confirms quietly", async () => {
    const view = renderPage([voice("x-voice-alba", { name: "Alba" }), voice("x-voice-mira", { name: "Mira" })], ["alba", "mira"], { voice: "alba" });
    await view.findByText("Mira");
    const radios = view.getAllByRole("radio");
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    const setter = spyOn(api, "setSetting").mockResolvedValue({ key: "tts.voice_id", value: "mira", source: "user", label: "Speaking voice", level: "basic", secret: false });
    fireEvent.click(radios[1]!);
    await waitFor(() => expect(setter).toHaveBeenCalledWith("person:person-1", "tts.voice_id", "mira"));
    await view.findByText("Saved.");
  });
  test("a failed save says what happened and what to do", async () => {
    const view = renderPage([voice("x-voice-alba", { name: "Alba" }), voice("x-voice-mira", { name: "Mira" })], ["alba", "mira"]);
    await view.findByText("Mira");
    spyOn(api, "setSetting").mockRejectedValue(new Error("boom"));
    fireEvent.click(view.getAllByRole("radio")[1]!);
    await view.findByText("Home could not save that voice. Try again.");
  });
  test("preview plays, shows Stop, and stops", async () => {
    const view = renderPage([voice("x-voice-alba", { name: "Alba" })]);
    const start = spyOn(voicePreviewPlayer, "start").mockImplementation(async (id: string) => { (voicePreviewPlayer as unknown as { update(s: unknown): void }).update({ voiceId: id, busy: false, error: null }); });
    const stop = spyOn(voicePreviewPlayer, "stop");
    fireEvent.click(await view.findByRole("button", { name: "Play Alba" }));
    expect(start).toHaveBeenCalledWith("x-voice-alba");
    const stopButton = await view.findByRole("button", { name: "Stop Alba" });
    stop.mockClear(); fireEvent.click(stopButton);
    expect(stop).toHaveBeenCalled();
  });
  test("no voices yet shows the warming line", async () => {
    const view = renderPage([voice("x-voice-alba", { onDisk: false })]);
    await view.findByText("Voices are still getting ready. This takes a minute after setup.");
  });
  test("a down voice service says what to do and offers a retry", async () => {
    const loader = spyOn(api, "stackVoices").mockRejectedValueOnce(new Error("Stack is offline")).mockResolvedValue({ voices: [] });
    const view = renderWithQueryClient(<VoiceBrowserSection person={person()} />);
    await view.findByText(/Home can't reach its voice service\. Check Repairs, then come back\./);
    fireEvent.click(await view.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });
  test("a locked setting has no choice and shows its own reason", async () => {
    const view = renderPage([voice("x-voice-alba", { name: "Alba" })], ["alba"], { locked: true, reason: "Set by a guardian." }); await view.findByText("Set by a guardian.");
    expect(view.getAllByRole("radio").every((radio) => radio.hasAttribute("disabled") || radio.getAttribute("aria-disabled") === "true" || (radio as HTMLButtonElement).disabled)).toBe(true);
  });
  test("a child gets the line asking a parent and cannot choose, but can preview", async () => {
    const view = renderPage([voice("x-voice-alba", { name: "Alba" })], ["alba"], { role: "child" }); await view.findByText("Alba");
    expect(view.getByText("Ask a parent to choose your voice.")).toBeTruthy();
    expect(view.getAllByRole("radio").every((radio) => (radio as HTMLButtonElement).disabled || radio.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(view.getByRole("button", { name: "Play Alba" })).toBeTruthy();
  });
  test("an admin chooses for a child from the Choose a voice for control and writes to the child's scope", async () => {
    spyOn(api, "stackVoices").mockResolvedValue({ voices: [voice("x-voice-alba", { name: "Alba" }), voice("x-voice-mira", { name: "Mira" })] });
    const child = { ...person("child"), id: "person-child", display_name: "Bramble" };
    spyOn(api, "people").mockResolvedValue([{ ...person("owner"), id: "person-1" }, child] as never);
    const setter = spyOn(api, "setSetting").mockResolvedValue({ key: "tts.voice_id", value: "mira", source: "user", label: "Speaking voice", level: "basic", secret: false });
    const settings = spyOn(api, "settingsValues").mockImplementation(async () => [{ key: "tts.voice_id", value: "alba", source: "user", label: "Speaking voice", level: "basic", secret: false } as never]);
    spyOn(api, "settingsRegistry").mockResolvedValue([{ key: "tts.voice_id", label: "Speaking voice", scope: "person", selector: "select", range: { options: ["alba", "mira"] }, default: "alba" }] as never);
    const view = renderWithQueryClient(<VoiceBrowserSection person={{ ...person("owner"), id: "person-1" }} />);
    await view.findByText("Alba");
    fireEvent.click(await view.findByRole("combobox", { name: "Choose a voice for" }));
    fireEvent.click(await view.findByRole("option", { name: "Bramble" }));
    await waitFor(() => expect(settings).toHaveBeenCalledWith("person:person-child"));
    await view.findByText("Choose a voice for Bramble");
    fireEvent.click(view.getAllByRole("radio")[1]!);
    await waitFor(() => expect(setter).toHaveBeenCalledWith("person:person-child", "tts.voice_id", "mira"));
  });
  test("an adult who is not an owner or admin sees no person control", async () => {
    const view = renderPage([voice("x-voice-alba", { name: "Alba" })]); await view.findByText("Alba");
    expect(view.queryAllByRole("combobox")).toHaveLength(0);
  });
});
