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

test("a multiple select shows the spec's option labels as chips", () => {
  const setting = {
    def: SettingsKey.parse({
      key: "search.web_sources",
      scope: "household",
      selector: "select",
      range: { options: ["searxng", "ddgs"], multiple: true },
      default: ["searxng"],
      label: "Web search sources",
      level: "advanced",
      lives_in: "household.search",
      honoured_by: ["home"],
      copy: { does: "Picks which search engines answer a web search.", option_labels: { searxng: "SearXNG", ddgs: "DuckDuckGo" } },
    }),
    resolved: { key: "search.web_sources", value: ["searxng", "ddgs"], source: "default", label: "Web search sources", level: "advanced", secret: false },
  } as unknown as MergedSetting;
  const { container } = render(<SettingField setting={setting} onChange={async () => true} onReset={() => {}} />);
  const chips = [...container.querySelectorAll('[data-slot="combobox-chip"]')].map((chip) => chip.textContent);
  expect(chips.join("|")).toContain("SearXNG");
  expect(chips.join("|")).toContain("DuckDuckGo");
});
