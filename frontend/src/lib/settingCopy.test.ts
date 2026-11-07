import { afterEach, expect, test } from "bun:test";
import { activateLocale } from "../i18n";
import { i18n } from "@lingui/core";
import { SETTING_COPY } from "./settingCopy.generated";
import { areaText, languageName, settingDoes, settingLabel, settingOptionLabel, settingReason, settingState } from "./settingCopy";

const first = Object.entries(SETTING_COPY).find(([id]) => id.endsWith(".label"))!;
const key = first[0].slice("setting.".length, -".label".length);
const def = { key, label: first[1].en, copy: { does: "Does a thing." } };

function useSpanish(messages: Record<string, string>) {
  i18n.load("es-test", messages);
  i18n.activate("es-test");
}
afterEach(() => i18n.activate("en-US"));

test("a label, option, area and state translate by generated id and fall back to English", () => {
  expect(settingLabel(def)).toBe(def.label);
  useSpanish({ [first[0]]: "Etiqueta", "area.Settings": "Ajustes", On: "Activado" });
  expect(settingLabel(def)).toBe("Etiqueta");
  expect(settingLabel({ ...def, label: "Edited server text" })).toBe("Edited server text");
  expect(areaText("Settings")).toBe("Ajustes");
  expect(areaText("Not a known area")).toBe("Not a known area");
  expect(settingState("On")).toBe("Activado");
  expect(settingState("42")).toBe("42");
  expect(settingOptionLabel(def, "auto", "Auto")).toBe("Auto");
  expect(settingDoes(def, "Does a thing.")).toBe("Does a thing.");
});

test("S5: a per-person reason line keeps the admin's name and a role word, with no gendered agreement", () => {
  const dad = "Turned off by Dad.";
  expect(settingReason(dad)).toBe(dad);
  useSpanish({ "setting.reason.set_by_guardian.child.off": "{admin} lo desactivó.", "setting.reason.set_by_guardian.admin.on": "Lo activaste para {person}." });
  expect(settingReason(dad)).toBe("Dad lo desactivó.");
  expect(settingReason("Turned off by Mamá y Papá.")).toBe("Mamá y Papá lo desactivó.");
  expect(settingReason("You turned this on for Nova.")).toBe("Lo activaste para Nova.");
  expect(settingReason("Applies to everyone in the home.")).toBe("Applies to everyone in the home.");
});

test("languages are named in their own language", () => {
  expect(languageName("es")).toBe("Español");
  expect(languageName("en-GB")).toMatch(/English/);
  expect(languageName("en-US")).toMatch(/English/);
});

test("the shipped es catalog translates an admin reason line with the person's name and a select option label", async () => {
  await activateLocale("es");
  try {
    const line = settingReason("You turned this on for Nova.");
    expect(line).not.toBe("You turned this on for Nova.");
    expect(line).toContain("Nova");
    const optionEntry = Object.entries(SETTING_COPY).find(([id]) => id.includes(".option_label."))!;
    const keyName = optionEntry[0].slice("setting.".length, optionEntry[0].indexOf(".option_label."));
    expect(settingOptionLabel({ key: keyName, label: "x" }, optionEntry[0].split(".option_label.")[1]!, optionEntry[1].en)).toBeTruthy();
  } finally {
    await activateLocale("en-US");
  }
});
