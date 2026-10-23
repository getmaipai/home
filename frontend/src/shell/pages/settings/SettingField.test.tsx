import { expect, test, mock } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { MergedSetting } from "@maipai/ui/src/settings/groupSettings";
import { SettingField } from "./SettingField";

test("renders does, state, and reason as kit descriptions without a wrapper", () => {
  const setting = {
    def: SettingsKey.parse({
      key: "test.description",
      scope: "person",
      selector: "boolean",
      default: false,
      label: "Example setting",
      level: "basic",
      lives_in: "person.test",
      honoured_by: ["home"],
    }),
    resolved: {
      key: "test.description",
      value: false,
      source: "default",
      label: "Example setting",
      level: "basic",
      secret: false,
      does: "Lets you choose this setting.",
      state: "Off",
      reason: "Turned off by your parents.",
    },
  } as MergedSetting;
  const { container } = render(<SettingField setting={setting} onChange={async () => true} onReset={() => {}} />);
  const descriptions = [...container.querySelectorAll('[data-slot="item-description"]')];
  expect(descriptions.map((description) => description.textContent)).toEqual([
    "Lets you choose this setting.",
    "Off",
    "Turned off by your parents.",
  ]);
  expect(descriptions).toHaveLength(3);
});

test("a select shows the plain-word option labels from the key's copy", () => {
  const setting = {
    def: SettingsKey.parse({
      key: "topics.bodies",
      scope: "person",
      selector: "select",
      range: { options: ["default", "redirect", "gentle"] },
      default: "default",
      label: "Bodies and relationships",
      level: "basic",
      lives_in: "person.topics",
      honoured_by: ["home"],
      copy: { does: "Sets how MaiPai talks about this.", option_labels: { default: "Follow child controls (recommended)", redirect: "Gently point to you", gentle: "Answer simply with correct body words" } },
    }),
    resolved: { key: "topics.bodies", value: "gentle", source: "user", label: "Bodies and relationships", level: "basic", secret: false },
  } as MergedSetting;
  const view = render(<SettingField setting={setting} onChange={async () => true} onReset={() => {}} />);
  expect(view.getByText("Answer simply with correct body words")).toBeTruthy();
  expect(view.queryByText("Gentle")).toBeNull();
});

test("dynamic model selects retain and explain the fixed off option", () => {
  const def = SettingsKey.parse({
    key: "engines.vision.choice", scope: "household", selector: "select",
    range: { options: ["off"], options_from: "models.vision" }, default: "auto",
    label: "Vision model choice", level: "basic", lives_in: "household.ai_models", honoured_by: ["home"],
    copy: { does: "Directs vision work.", options: { off: "Off: Home will not use photo understanding." } },
  });
  const view = render(<SettingField setting={{ def, resolved: { key: def.key, value: "auto", source: "default", label: def.label, level: "basic", secret: false } } as MergedSetting} onChange={async () => true} onReset={() => {}} />);
  fireEvent.click(view.getByRole("combobox", { name: "Vision model choice" }));
  expect(view.getByText("Off: Home will not use photo understanding.")).toBeTruthy();
});

test("turning companions off requires confirmation and cancel changes nothing", async () => {
  const onChange = mock(async () => true);
  const setting = {
    def: SettingsKey.parse({ key: "companions.allowed", scope: "person", selector: "boolean", layers: ["household", "person"], merge: "override", default: true, label: "AI companions", help: "They are on by default.", level: "basic", lives_in: "person.companions", honoured_by: ["home"] }),
    resolved: { key: "companions.allowed", value: true, source: "user", label: "AI companions", level: "basic", secret: false },
  } as MergedSetting;
  const view = render(<SettingField setting={setting} onChange={onChange} onReset={() => {}} />);
  fireEvent.click(view.getByRole("switch", { name: "AI companions" }));
  expect(await view.findByRole("alertdialog")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(onChange).not.toHaveBeenCalled());
  fireEvent.click(view.getByRole("switch", { name: "AI companions" }));
  fireEvent.click(await view.findByRole("button", { name: "Turn off" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(false));
});
