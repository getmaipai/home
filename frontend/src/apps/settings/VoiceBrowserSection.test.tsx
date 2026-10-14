import { afterEach, describe, expect, test, mock, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { VoiceBrowserSection } from "@/apps/settings/VoiceBrowserSection";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { StackVoice, Roster } from "@/lib/api";

const person = (role: Roster["role"] = "adult"): Roster => ({ id: "person-1", display_name: "Taylor", role, nickname: null, avatar_seed: "x", source: "hub", local_only: false, created_at: "", updated_at: "", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "", hasSecret: false } as Roster);
const voice = (id: string, more: Partial<StackVoice> = {}): StackVoice => ({ id, name: id, description: "A voice", language: "en", country: "US", gender: "female", source: "preset", engine: "engine-a", onDisk: true, licence: null, revision: "", ...more });

afterEach(() => { cleanup(); mock.restore(); });

function renderPage(voices: StackVoice[], options = ["alba", "mira"], settings: Record<string, unknown> = {}) {
  spyOn(api, "stackVoices").mockResolvedValue({ voices });
  spyOn(api, "settingsRegistry").mockResolvedValue([{ key: "tts.voice_id", label: "Speaking voice", scope: "person", selector: "select", range: { options }, default: "alba", control: { child: "self", teen: "self", adult: "self" }, band_default: { child: "alba", teen: "alba", adult: "alba" }, copy: { does: "Sets speaking voice" } }] as never);
  spyOn(api, "settingsValues").mockResolvedValue([{ key: "tts.voice_id", value: settings.voice ?? "alba", source: "default", label: "Speaking voice", level: "basic", secret: false, locked: settings.locked as boolean | undefined, reason: settings.reason as string | undefined }]);
  spyOn(api, "setSetting").mockResolvedValue({ key: "tts.voice_id", value: "alba", source: "user", label: "Speaking voice", level: "basic", secret: false });
  return renderWithQueryClient(<VoiceBrowserSection person={person(settings.role as Roster["role"] | undefined)} />);
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
      await waitFor(() => expect(view.queryAllByText("alba")).toHaveLength(0));
      fireEvent.click(view.getByLabelText(label));
      fireEvent.click(await view.findByRole("option", { name: "All" }));
      await view.findAllByText("alba");
    }
    fireEvent.click(view.getByLabelText("Filter by language"));
    fireEvent.click(await view.findByRole("option", { name: "fr" }));
    fireEvent.click(view.getByLabelText("Filter by source"));
    fireEvent.click(await view.findByRole("option", { name: "community" }));
    await waitFor(() => expect(view.queryAllByText("alba")).toHaveLength(0));
    expect(view.getAllByText("mira").length).toBeGreaterThan(0);
  });
  test("searching by name narrows the list", async () => {
    const view = renderPage([voice("alba"), voice("mira")]); await view.findAllByText("alba");
    fireEvent.change(view.getByLabelText("Search voice names"), { target: { value: "mir" } });
    await waitFor(() => expect(view.queryByText("alba")).toBeNull());
  });
  test("a preset row offers Use this voice and picking it writes the person's own voice setting; a community row does not offer it", async () => {
    const view = renderPage([voice("engine-a-voice-alba"), voice("engine-a-voice-mira"), voice("community", { source: "community" })], ["alba", "mira"]); await view.findAllByText("community");
    const setter = spyOn(api, "setSetting").mockResolvedValue({ key: "tts.voice_id", value: "mira", source: "user", label: "Speaking voice", level: "basic", secret: false });
    const buttons = view.getAllByRole("button", { name: "Use this voice" }); expect(buttons).toHaveLength(2); fireEvent.click(buttons[0]!);
    const communityRow = view.getAllByText("community")[0]!.closest('[role="row"]');
    expect(communityRow?.querySelector("button")).toBeNull();
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
    expect(view.queryByRole("button", { name: "Use this voice" })).toBeNull();
  });
  test("a child sees only preset voices", async () => {
    const view = renderPage([voice("alba"), voice("community", { source: "community" })], ["alba"], { role: "child" }); await view.findAllByText("alba");
    expect(view.queryByText("community")).toBeNull();
  });
});
