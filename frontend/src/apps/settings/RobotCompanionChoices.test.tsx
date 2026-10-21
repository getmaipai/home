import { afterEach, describe, expect, test, mock, spyOn } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api, type RobotCompanionInfo, type StackVoice } from "@/lib/api";
import { RobotCompanionChoices } from "@/apps/settings/RobotCompanionChoices";
import { CompanionVoiceSelect, companionVoiceKey } from "@/apps/settings/CompanionVoiceSelect";

afterEach(() => { cleanup(); mock.restore(); });

const voice = (id: string, name: string): StackVoice => ({ id, name, description: "unknown", language: "en", country: "US", gender: "female", source: "cloned", engine: "chatterbox-turbo", onDisk: true, licence: null, revision: "r" });
const info = (more: Partial<RobotCompanionInfo> = {}): RobotCompanionInfo => ({
  controls: "child", companion_id: "rivet", home_location_set: true,
  companions: [{ id: "rivet", name: "Rivet", type: "child", audience: "all" }, { id: "lively-adult", name: "Nova", type: "child", audience: "all" }],
  speaking: { voice_id: "default", source: "home" }, ...more,
});

describe("RobotCompanionChoices", () => {
  test("says which voice the robot speaks in and where it comes from", async () => {
    spyOn(api, "stackVoices").mockResolvedValue({ voices: [voice("voice-bee1234", "Bee-Mo")] });
    spyOn(api, "robotCompanion").mockResolvedValue(info({ speaking: { voice_id: "voice-bee1234", source: "companion", companion_name: "Rivet" } }));
    const view = render(<MemoryRouter><RobotCompanionChoices deviceId="d1" /></MemoryRouter>);
    await view.findByText("Speaking in Bee Mo, from the companion Rivet.");
  });

  test("the plain home-default case, and an explicit companion is labeled for who may use it", async () => {
    spyOn(api, "stackVoices").mockResolvedValue({ voices: [] });
    spyOn(api, "robotCompanion").mockResolvedValue(info({ controls: "adult", companions: [{ id: "rivet", name: "Rivet", type: "child", audience: "all" }, { id: "edgy", name: "Edge", type: "adult", audience: "adult" }] }));
    const view = render(<MemoryRouter><RobotCompanionChoices deviceId="d1" /></MemoryRouter>);
    await view.findByText("Speaking in Home's default voice.");
    expect(view.getAllByText(/Adult answers/).length).toBeGreaterThan(0);
  });
});

describe("CompanionVoiceSelect", () => {
  test("names the setting the way the hub does", () => {
    expect(companionVoiceKey("lively-child")).toBe("companion.voice.lively_child");
  });
  test("saves the household setting for the companion", async () => {
    spyOn(api, "stackVoices").mockResolvedValue({ voices: [voice("voice-bee1234", "Bee-Mo")] });
    const save = spyOn(api, "setSetting").mockResolvedValue({} as never);
    const view = render(<CompanionVoiceSelect companionId="rivet" companionName="Rivet" value="default" />);
    const select = await view.findByRole("combobox", { name: "Rivet's voice" });
    fireEvent.click(select);
    fireEvent.click(await view.findByRole("option", { name: "Bee Mo" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("household", "companion.voice.rivet", "voice-bee1234"));
  });
});
