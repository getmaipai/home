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
  spyOn(api, "setSetting").mockImplementation(async (_scope: string, key: string, value: unknown) => ({ key, value, source: "user", label: "Speaking voice", level: "basic", secret: false }) as never);
  return renderWithQueryClient(<VoiceBrowserSection person={actor} />);
}

const trigger = (view: ReturnType<typeof renderPage>) => view.findByRole("combobox", { name: "Voice for you" });
const three = () => [voice("x-voice-alba", { name: "Alba" }), voice("x-voice-javert", { name: "Javert", onDisk: false }), voice("x-voice-mira", { name: "Mira", onDisk: false })];

describe("VoiceBrowserSection", () => {
  test("exactly one voice control: one dropdown, no radios, no engine words", async () => {
    const view = renderPage([voice("pocket-tts-voice-alba", { name: "Alba" }), voice("pocket-tts-voice-mira", { name: "Mira" })], ["alba", "mira"]);
    await trigger(view);
    expect(view.getAllByRole("combobox")).toHaveLength(1);
    expect(view.queryAllByRole("radio")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/chatterbox|pocket|orpheus|mlx|clone|upload|unknown|catalog/i);
  });
  test("lists every preset, installed or not, and no community or cloned rows", async () => {
    const view = renderPage([...three(), voice("c", { name: "Community", source: "community" }), voice("k", { name: "Cloned", source: "cloned" })], ["alba", "javert", "mira"]);
    fireEvent.click(await trigger(view));
    const names = (await view.findAllByRole("option")).map((option) => option.textContent);
    expect(names).toEqual(["Default voice", "Alba", "Javert", "Mira"]);
  });
  test("the dropdown shows the stored voice", async () => {
    const view = renderPage(three(), ["alba", "javert", "mira"], { voice: "javert" });
    expect((await trigger(view)).textContent).toBe("Javert");
  });
  test("a stored voice the engine does not offer falls back to the default with one plain line, never a dead select", async () => {
    const view = renderPage(three(), ["default", "alba", "javert", "mira"], { voice: "vera" });
    expect((await trigger(view)).textContent).toBe("Default voice");
    view.getByText("Vera is not available with this engine, using the default voice.");
    expect((view.getByRole("button", { name: "Test" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("one built-in voice (the Chatterbox shape): a saved Javert shows the default voice, the select works, Test plays the engine voice, the stale choice is moved to default once", async () => {
    const view = renderPage([voice("chatterbox-turbo-voice-default", { name: "Chatterbox default", engine: "chatterbox-turbo" })], ["default", "alba", "javert"], { voice: "javert" });
    const box = await trigger(view);
    expect(box.textContent).toBe("Default voice");
    expect(box.hasAttribute("disabled") || box.getAttribute("data-disabled") !== null).toBe(false);
    view.getByText("Javert is not available with this engine, using the default voice.");
    const start = spyOn(voicePreviewPlayer, "start").mockImplementation(async () => {});
    fireEvent.click(view.getByRole("button", { name: "Test" }));
    expect(start).toHaveBeenCalledWith("chatterbox-turbo-voice-default");
    // The page moves the unavailable saved voice to the default once, and keeps the line.
    await waitFor(() => expect(api.setSetting).toHaveBeenCalledWith("person:person-1", "tts.voice_id", "default"));
    await waitFor(() => view.getByText("Javert is not available with this engine, using the default voice."));
    expect(document.body.textContent).not.toMatch(/chatterbox/i);
  });
  test("choosing another voice saves at once and confirms quietly", async () => {
    const view = renderPage(three(), ["alba", "javert", "mira"], { voice: "alba" });
    const setter = spyOn(api, "setSetting").mockResolvedValue({ key: "tts.voice_id", value: "mira", source: "user", label: "Speaking voice", level: "basic", secret: false });
    fireEvent.click(await trigger(view));
    fireEvent.click(await view.findByRole("option", { name: "Mira" }));
    await waitFor(() => expect(setter).toHaveBeenCalledWith("person:person-1", "tts.voice_id", "mira"));
    await view.findByText("Saved.");
    await waitFor(async () => expect((await trigger(view)).textContent).toBe("Mira"));
  });
  test("a failed save says what happened and what to do", async () => {
    const view = renderPage(three(), ["alba", "javert", "mira"]);
    spyOn(api, "setSetting").mockRejectedValue(new Error("boom"));
    fireEvent.click(await trigger(view));
    fireEvent.click(await view.findByRole("option", { name: "Mira" }));
    await view.findByText("Home could not save that voice. Try again.");
  });
  test("Test plays the selected voice, shows Stop, and stops", async () => {
    const view = renderPage(three(), ["alba", "javert", "mira"], { voice: "javert" });
    const start = spyOn(voicePreviewPlayer, "start").mockImplementation(async (id: string) => { (voicePreviewPlayer as unknown as { update(s: unknown): void }).update({ voiceId: id, busy: false, error: null }); });
    const stop = spyOn(voicePreviewPlayer, "stop");
    await trigger(view);
    fireEvent.click(view.getByRole("button", { name: "Test" }));
    expect(start).toHaveBeenCalledWith("x-voice-javert");
    const stopButton = await view.findByRole("button", { name: "Stop" });
    stop.mockClear(); fireEvent.click(stopButton);
    expect(stop).toHaveBeenCalled();
  });
  test("owner ruling 2026-10-17: testing a voice that is not downloaded yet says it is downloading; an installed one does not", async () => {
    const view = renderPage(three(), ["alba", "javert", "mira"], { voice: "javert" });
    const start = spyOn(voicePreviewPlayer, "start").mockImplementation(async (id: string) => { (voicePreviewPlayer as unknown as { update(s: unknown): void }).update({ voiceId: id, busy: true, error: null }); });
    await trigger(view);
    fireEvent.click(view.getByRole("button", { name: "Test" }));
    expect(start).toHaveBeenCalledWith("x-voice-javert");
    await view.findByText("Downloading this voice, one moment.");
    voicePreviewPlayer.stop();
  });
  test("a voice already on disk shows no download note while it prepares", async () => {
    const view = renderPage(three(), ["alba", "javert", "mira"], { voice: "alba" });
    spyOn(voicePreviewPlayer, "start").mockImplementation(async (id: string) => { (voicePreviewPlayer as unknown as { update(s: unknown): void }).update({ voiceId: id, busy: true, error: null }); });
    await trigger(view);
    fireEvent.click(view.getByRole("button", { name: "Test" }));
    await waitFor(() => expect((view.getByRole("button", { name: "Test" }) as HTMLButtonElement).disabled).toBe(true));
    expect(view.queryByText("Downloading this voice, one moment.")).toBeNull();
    voicePreviewPlayer.stop();
  });
  test("no voices yet shows the warming line and a disabled Test", async () => {
    const view = renderPage([]);
    await view.findByText("Voices are still getting ready. This takes a minute after setup.");
    expect((view.getByRole("button", { name: "Test" }) as HTMLButtonElement).disabled).toBe(true);
  });
  test("a down voice service says what to do, offers a retry, and Test is off", async () => {
    const loader = spyOn(api, "stackVoices").mockRejectedValueOnce(new Error("Stack is offline")).mockResolvedValue({ voices: [] });
    const view = renderWithQueryClient(<VoiceBrowserSection person={person()} />);
    await view.findByText(/Home can't reach its voice service\. Check Repairs, then come back\./);
    expect((view.getByRole("button", { name: "Test" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await view.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });
  test("a locked setting has no choice and shows its own reason", async () => {
    const view = renderPage(three(), ["alba", "javert", "mira"], { locked: true, reason: "Set by a guardian." }); await view.findByText("Set by a guardian.");
    expect((await trigger(view)).hasAttribute("disabled") || (await trigger(view)).getAttribute("data-disabled") !== null).toBe(true);
  });
  test("a child gets the line asking a parent and cannot choose, but can test", async () => {
    const view = renderPage(three(), ["alba", "javert", "mira"], { role: "child" }); const box = await trigger(view);
    expect(view.getByText("Ask a parent to choose your voice.")).toBeTruthy();
    expect(box.hasAttribute("disabled") || box.getAttribute("data-disabled") !== null).toBe(true);
    expect((view.getByRole("button", { name: "Test" }) as HTMLButtonElement).disabled).toBe(false);
  });
  test("an admin chooses for a child from the Choose a voice for control and writes to the child's scope", async () => {
    spyOn(api, "stackVoices").mockResolvedValue({ voices: [voice("x-voice-alba", { name: "Alba" }), voice("x-voice-mira", { name: "Mira" })] });
    const child = { ...person("child"), id: "person-child", display_name: "Bramble" };
    spyOn(api, "people").mockResolvedValue([{ ...person("owner"), id: "person-1" }, child] as never);
    const setter = spyOn(api, "setSetting").mockResolvedValue({ key: "tts.voice_id", value: "mira", source: "user", label: "Speaking voice", level: "basic", secret: false });
    const settings = spyOn(api, "settingsValues").mockImplementation(async () => [{ key: "tts.voice_id", value: "alba", source: "user", label: "Speaking voice", level: "basic", secret: false } as never]);
    spyOn(api, "settingsRegistry").mockResolvedValue([{ key: "tts.voice_id", label: "Speaking voice", scope: "person", selector: "select", range: { options: ["alba", "mira"] }, default: "alba" }] as never);
    const view = renderWithQueryClient(<VoiceBrowserSection person={{ ...person("owner"), id: "person-1" }} />);
    fireEvent.click(await view.findByRole("combobox", { name: "Choose a voice for" }));
    fireEvent.click(await view.findByRole("option", { name: "Bramble" }));
    await waitFor(() => expect(settings).toHaveBeenCalledWith("person:person-child"));
    await view.findByText("Choose a voice for Bramble");
    fireEvent.click(await view.findByRole("combobox", { name: "Voice for Bramble" }));
    fireEvent.click(await view.findByRole("option", { name: "Mira" }));
    await waitFor(() => expect(setter).toHaveBeenCalledWith("person:person-child", "tts.voice_id", "mira"));
  });
  test("an adult who is not an owner or admin sees no person control", async () => {
    const view = renderPage(three()); await trigger(view);
    expect(view.getAllByRole("combobox")).toHaveLength(1);
  });
});
