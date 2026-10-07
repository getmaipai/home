import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
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
