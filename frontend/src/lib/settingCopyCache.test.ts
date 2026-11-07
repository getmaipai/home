import { afterEach, expect, test } from "bun:test";
import { i18n } from "@lingui/core";
import { QueryClient } from "@tanstack/react-query";
import { SETTING_COPY } from "./settingCopy.generated";
import { installSettingCopyCache, translateRegistry, translateValues } from "./settingCopyCache";

afterEach(() => i18n.activate("en-US"));
const labelId = Object.keys(SETTING_COPY).find((id) => id.endsWith(".label"))!;
const key = labelId.slice("setting.".length, -".label".length);
const def = { key, label: SETTING_COPY[labelId]!.en, copy: { does: "Does a thing." } };

test("registry and values caches are re-translated from the English source on every language change", () => {
  const client = new QueryClient();
  client.setQueryData(["settings-registry"], [def]);
  client.setQueryData(["settings-values", "household"], [{ key, value: true, label: def.label, does: "Does a thing." }]);
  const stop = installSettingCopyCache(client);
  i18n.load("es-cache", { [labelId]: "Etiqueta" });
  i18n.activate("es-cache");
  expect((client.getQueryData(["settings-registry"]) as typeof def[])[0]!.label).toBe("Etiqueta");
  expect((client.getQueryData(["settings-values", "household"]) as { label: string }[])[0]!.label).toBe("Etiqueta");
  i18n.activate("en-US");
  expect((client.getQueryData(["settings-registry"]) as typeof def[])[0]!.label).toBe(def.label);
  stop();
});

test("with no translation the copy is unchanged", () => {
  expect(translateRegistry([def])[0]!.label).toBe(def.label);
  expect(translateValues([{ key, label: def.label, state: "On" }], [def])[0]).toEqual({ key, label: def.label, state: "On" });
});
