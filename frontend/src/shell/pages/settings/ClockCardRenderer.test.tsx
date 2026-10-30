import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { SettingsAreaPage } from "@/shell/pages/settings/SettingsAreaPage";
import { makePerson, mockHome, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import * as alarmSounds from "@/lib/alarmSounds";

const playMock = spyOn(alarmSounds, "playAlarmSound").mockReturnValue({ blocked: false, stop() {} });
let fixture: HomeFixture | null = null;
afterEach(() => { cleanup(); fixture?.restore(); fixture = null; playMock.mockClear(); });

describe("Clock settings card", () => {
  test("shows all three controls and Preview calls the sound player with the saved sound and volume", async () => {
    fixture = mockHome({ extraKeys: [
      { key: "alarms.sound", scope: "person", selector: "select", range: { options: ["none", "bell", "chime", "digital", "rise", "gentle"] }, default: "bell", label: "Alarm sound", level: "basic", lives_in: "person.clock", honoured_by: ["home"], secret: false },
      { key: "alarms.volume", scope: "person", selector: "select", range: { options: ["low", "medium", "high"] }, default: "high", label: "Alarm volume", level: "basic", lives_in: "person.clock", honoured_by: ["home"], secret: false },
      { key: "alarms.snooze_minutes", scope: "person", selector: "select", range: { options: ["5", "10", "15", "30", "60"] }, default: "10", label: "Snooze duration", level: "basic", lives_in: "person.clock", honoured_by: ["home"], secret: false },
    ] });
    const view = renderWithQueryClient(<MemoryRouter initialEntries={["/settings/clock"]}><Routes><Route element={<FullLayout />}><Route path="settings/:section?" element={<SettingsAreaPage person={makePerson("adult")} onPersonChange={() => {}} />} /></Route></Routes></MemoryRouter>);
    await waitFor(() => expect(view.getByText("Alarm sound")).toBeTruthy());
    expect(view.getByText("Alarm volume")).toBeTruthy();
    expect(view.getByText("Snooze duration")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(playMock).toHaveBeenCalledWith("bell", "high"));
  });
});
