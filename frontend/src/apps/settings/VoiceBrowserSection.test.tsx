import { afterEach, describe, expect, test, mock, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { voicePreviewPlayer } from "@/lib/voice/voicePreviewPlayer";
import { VoiceBrowserSection } from "@/apps/settings/VoiceBrowserSection";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { StackVoice, Roster } from "@/lib/api";

const person = (role: Roster["role"] = "adult"): Roster => ({ id: "person-1", display_name: "Taylor", role, nickname: null, avatar_seed: "x", source: "hub", local_only: false, created_at: "", updated_at: "", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "", hasSecret: false } as Roster);
const voice = (id: string, more: Partial<StackVoice> = {}): StackVoice => ({ id, name: id, description: "A voice", language: "en", country: "US", gender: "female", source: "preset", engine: "engine-a", onDisk: true, licence: null, revision: "", ...more });

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
  test("a voice with no metadata still lists with unknown values instead of being dropped", async () => {
    const v = voice("mystery", { description: "unknown", language: "unknown", country: "unknown", gender: "unknown", source: "unknown" });
    const view = renderPage([v]);
    await view.findAllByText("mystery");
    expect(view.getAllByText("unknown").length).toBeGreaterThanOrEqual(4);
  });
  test("two voices from two engines list in the same rows and filter by the same controls", async () => {
    const view = renderPage([voice("alba", { engine: "engine-a" }), voice("mira", { engine: "engine-b" })]);
    await view.findAllByText("alba"); await view.findAllByText("mira");
    for (const file of ["src/apps/settings/VoiceBrowserSection.tsx", "src/lib/voice/voiceBrowserRows.ts"]) {
      expect(readFileSync(resolve(import.meta.dir, "../../..", file), "utf8")).not.toMatch(/engine-a|engine-b|pocket/i);
    }
    fireEvent.click(view.getByLabelText("Filter by source"));
    fireEvent.click(await view.findByRole("option", { name: "preset" }));
    expect(view.getAllByText("alba").length).toBeGreaterThan(0);
    expect(view.getAllByText("mira").length).toBeGreaterThan(0);
  });
  test("filtering by language, country, gender and source narrows the list, and All restores it", async () => {
    const view = renderPage([voice("alba"), voice("mira", { language: "fr", country: "FR", gender: "male", source: "community" })]);
    await view.findAllByText("alba"); await view.findAllByText("mira");
    for (const [label, value] of [["Filter by language", "fr"], ["Filter by country", "FR"], ["Filter by gender", "male"], ["Filter by source", "community"]] as const) {
      fireEvent.click(view.getByLabelText(label));
      fireEvent.click(await view.findByRole("option", { name: value }));
      await waitFor(() => expect(view.queryAllByRole("row").some((row) => row.textContent?.includes("alba"))).toBe(false));
      fireEvent.click(view.getByLabelText(label));
      fireEvent.click(await view.findByRole("option", { name: "All" }));
      await view.findAllByText("alba");
    }
    fireEvent.click(view.getByLabelText("Filter by language"));
    fireEvent.click(await view.findByRole("option", { name: "fr" }));
    fireEvent.click(view.getByLabelText("Filter by source"));
    fireEvent.click(await view.findByRole("option", { name: "community" }));
    await waitFor(() => expect(view.queryAllByRole("row").some((row) => row.textContent?.includes("alba"))).toBe(false));
    expect(view.getAllByText("mira").length).toBeGreaterThan(0);
  });
  test("searching by name narrows the list", async () => {
    const view = renderPage([voice("alba"), voice("mira")]); await view.findAllByText("alba");
    fireEvent.change(view.getByLabelText("Search voice names"), { target: { value: "mir" } });
    await waitFor(() => expect(view.queryAllByRole("row").some((row) => row.textContent?.includes("alba"))).toBe(false));
  });
  test("a preset row offers Use this voice and picking it writes the person's own voice setting; a community row does not offer it", async () => {
    const view = renderPage([voice("engine-a-voice-alba"), voice("engine-a-voice-mira"), voice("community", { source: "community" })], ["alba", "mira"]); await view.findAllByText("community");
    const setter = spyOn(api, "setSetting").mockResolvedValue({ key: "tts.voice_id", value: "alba", source: "user", label: "Speaking voice", level: "basic", secret: false });
    const buttons = view.getAllByRole("button", { name: "Use this voice" }); expect(buttons.length).toBeGreaterThanOrEqual(2); fireEvent.click(buttons[0]!);
    const communityRow = view.getAllByText("community").find((node) => node.closest('[role="row"]'))?.closest('[role="row"]');
    expect(communityRow?.textContent).not.toContain("Use this voice");
    await waitFor(() => expect(setter).toHaveBeenCalledWith("person:person-1", "tts.voice_id", "mira"));
  });
  test("the current voice is marked", async () => { const view = renderPage([voice("alba")], ["alba"], { voice: "alba" }); await view.findAllByText("Current voice"); });
  test("a failed load shows the error with the next step and a retry", async () => {
    const loader = spyOn(api, "stackVoices").mockRejectedValueOnce(new Error("Stack is offline")).mockResolvedValue({ voices: [] });
    const view = renderWithQueryClient(<VoiceBrowserSection person={person()} />);
    await view.findByText("Stack is offline"); await view.findByRole("button", { name: "Try again" }).then(fireEvent.click);
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });
  test("a locked setting has no action and shows its own reason", async () => {
    const view = renderPage([voice("alba")], ["alba"], { locked: true, reason: "Set by a guardian." }); await view.findByText("Set by a guardian.");
    expect(view.queryAllByRole("button", { name: "Use this voice" })).toHaveLength(0);
  });
  test("a child sees only preset voices, no Use button and the line asking a parent", async () => {
    const view = renderPage([voice("alba"), voice("community", { source: "community" })], ["alba"], { role: "child" }); await view.findAllByText("alba");
    expect(view.queryAllByText("community")).toHaveLength(0);
    expect(view.queryAllByRole("button", { name: "Use this voice" })).toHaveLength(0);
    expect(view.getByText("Ask a parent to choose your voice.")).toBeTruthy();
  });

  test("an admin chooses a child from the Choosing a voice for control and writes to the child's scope", async () => {
    spyOn(api, "stackVoices").mockResolvedValue({ voices: [voice("alba"), voice("community", { source: "community" })] });
    const child = { ...person("child"), id: "person-child", display_name: "Bramble" };
    spyOn(api, "people").mockResolvedValue([{ ...person("owner"), id: "person-1" }, child] as never);
    const setter = spyOn(api, "setSetting").mockResolvedValue({ key: "tts.voice_id", value: "alba", source: "user", label: "Speaking voice", level: "basic", secret: false });
    const settings = spyOn(api, "settingsValues").mockImplementation(async () => [{ key: "tts.voice_id", value: "alba", source: "user", label: "Speaking voice", level: "basic", secret: false } as never]);
    spyOn(api, "settingsRegistry").mockResolvedValue([{ key: "tts.voice_id", label: "Speaking voice", scope: "person", selector: "select", range: { options: ["alba", "mira"] }, default: "alba" }] as never);
    const view = renderWithQueryClient(<VoiceBrowserSection person={{ ...person("owner"), id: "person-1" }} />);
    await view.findAllByText("alba");
    fireEvent.click(view.getByRole("combobox", { name: "Choosing a voice for" }));
    const childOption = await view.findByRole("option", { name: "Bramble" });
    fireEvent.click(childOption);
    await waitFor(() => expect(settings).toHaveBeenCalledWith("person:person-child"));
    expect(view.getByText("Ask a parent to choose your voice.")).toBeTruthy();
    expect(view.queryAllByRole("button", { name: "Use this voice" })).toHaveLength(0);
    expect(setter).not.toHaveBeenCalled();
  });

  test("an adult who is not an owner or admin sees no Choosing a voice for control", async () => {
    const view = renderPage([voice("alba")]); await view.findAllByText("alba");
    expect(view.queryAllByRole("combobox", { name: "Choosing a voice for" })).toHaveLength(0);
  });

  test("a voice not installed offers no Use button", async () => {
    const view = renderPage([voice("mira", { onDisk: false })], ["mira"]); await view.findAllByText("mira");
    const row = view.getAllByText("mira").find((node) => node.closest('[role="row"]'))?.closest('[role="row"]');
    expect(row?.textContent).toContain("Not installed");
    expect(row?.querySelector("button")?.textContent).not.toBe("Use this voice");
  });

  test("an on-disk voice shows Play and an uninstalled voice shows Download, never both", async () => {
    const view = renderPage([voice("ready"), voice("missing", { onDisk: false })], ["alba"], { role: "owner" });
    await view.findAllByText("ready"); await view.findAllByText("missing");
    const readyRow = view.getAllByText("ready").find((node) => node.closest('[role="row"]'))!.closest('[role="row"]')!;
    const missingRow = view.getAllByText("missing").find((node) => node.closest('[role="row"]'))!.closest('[role="row"]')!;
    expect(readyRow.querySelectorAll("button").length).toBe(1);
    expect(readyRow.querySelector("button")?.textContent).toBe("Play");
    expect(missingRow.querySelectorAll("button").length).toBe(1);
    expect(missingRow.querySelector("button")?.textContent).toBe("Download");
  });

  test("Download calls preview once, shows the working state, then refreshes the row to Play", async () => {
    spyOn(api, "people").mockResolvedValue([{ ...person("owner"), id: "person-1" }] as never);
    const load = spyOn(api, "stackVoices").mockResolvedValueOnce({ voices: [voice("missing", { onDisk: false })] }).mockResolvedValue({ voices: [voice("missing", { onDisk: true })] });
    spyOn(api, "settingsRegistry").mockResolvedValue([{ key: "tts.voice_id", label: "Speaking voice", scope: "person", selector: "select", range: { options: ["alba"] }, default: "alba" }] as never);
    spyOn(api, "settingsValues").mockResolvedValue([{ key: "tts.voice_id", value: "alba", source: "default", label: "Speaking voice", level: "basic", secret: false }]);
    spyOn(api, "previewVoice").mockResolvedValue(new Response(new Uint8Array(44), { headers: { "content-type": "audio/wav" } }));
    const view = renderWithQueryClient(<VoiceBrowserSection person={person("owner")} />);
    const download = (await view.findAllByRole("button", { name: "Download" }))[0]!; fireEvent.click(download);
    expect((await view.findAllByRole("button", { name: "Downloading" }))[0]!.hasAttribute("disabled")).toBe(true);
    expect(api.previewVoice).toHaveBeenCalledTimes(1);
    await view.findAllByRole("button", { name: "Play" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("a failed preview shows its error and returns the row to idle", async () => {
    const view = renderPage([voice("ready")]); await view.findAllByText("ready");
    spyOn(api, "previewVoice").mockRejectedValue(new Error("Home cannot preview this voice yet. Ask the person who manages Home to check Settings."));
    const play = [...document.querySelectorAll("button")].find((button) => button.textContent === "Play")!;
    fireEvent.click(play);
    await waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("Ask the person who manages Home"));
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "Play")).toBe(true);
  });

  test("leaving the page stops playback", async () => {
    const stop = spyOn(voicePreviewPlayer, "stop").mockImplementation(() => {});
    const view = renderPage([voice("ready")]); await view.findAllByText("ready");
    view.unmount();
    expect(stop).toHaveBeenCalled();
  });

  test("unknown voice metadata still gets its Play or Download action from onDisk", async () => {
    const view = renderPage([voice("mystery", { onDisk: true, source: "unknown", name: "", description: "", language: "", country: "" })]);
    await view.findAllByText("mystery");
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "Play")).toBe(true);
  });

  test("a non-admin sees Not installed guidance without Download", async () => {
    const view = renderPage([voice("missing", { onDisk: false })]);
    await view.findAllByText("missing");
    expect(view.getAllByText("Not installed. This voice is not on this home yet. Ask the person who manages Home to add it.").length).toBeGreaterThan(0);
    expect(view.queryByRole("button", { name: "Download" })).toBeNull();
  });
});
