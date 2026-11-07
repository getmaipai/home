import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { createRequire } from "node:module";
import { I18nProvider } from "@lingui/react";
import { i18n as kitI18n } from "@maipai/ui/src/i18n";
import { SettingRow } from "@maipai/ui/src/settings/SettingRow";
import type { MergedSetting } from "@maipai/ui/src/settings/groupSettings";
import { activateLocale, i18n } from "@/i18n";
import { LocaleKey } from "@/App";

afterEach(async () => { cleanup(); await activateLocale("en-US"); });

const changed = {
  def: { key: "person.chat.sample", scope: "person", selector: "boolean", default: false, label: "Sample setting", level: "basic", secret: false, lives_in: "person.chat", honoured_by: ["home"] },
  resolved: { key: "person.chat.sample", value: true, source: "user", label: "Sample setting", level: "basic", secret: false },
} as unknown as MergedSetting;

function Row() {
  return <SettingRow setting={changed} onChange={async () => true} onReset={() => {}} />;
}

describe("kit strings follow Home's active language (I18N-K1b)", () => {
  test("Home and the kit share one @lingui/core instance", () => {
    const fromKit = createRequire(require.resolve("@maipai/ui/src/i18n")).resolve("@lingui/core");
    const fromHome = createRequire(import.meta.url).resolve("@lingui/core");
    expect(fromKit).toBe(fromHome);
  });

  test("after activation in Spanish a kit Element and the composer placeholder read Spanish", async () => {
    await activateLocale("es");
    expect(i18n.locale).toBe("es");
    const view = render(<I18nProvider i18n={i18n}><Row /></I18nProvider>);
    expect(view.getByRole("button", { name: "Restablecer valores predeterminados" })).toBeTruthy();
    expect(kitI18n._({ id: "ui.Send a message...", message: "Send a message..." })).toBe("Enviar un mensaje...");
  });

  test("the child and teen mode locales read the kit's Spanish too", async () => {
    await activateLocale("es", "child");
    expect(i18n.locale).toBe("es-x-child");
    expect(kitI18n._({ id: "ui.Reset to default", message: "Reset to default" })).toBe("Restablecer valores predeterminados");
  });

  test("a language switch re-renders a kit string without a reload", async () => {
    await activateLocale("en-US");
    const view = render(<I18nProvider i18n={i18n}><LocaleKey><Row /></LocaleKey></I18nProvider>);
    expect(view.getByRole("button", { name: "Reset to default" })).toBeTruthy();
    await act(async () => { await activateLocale("es"); });
    expect(view.getByRole("button", { name: "Restablecer valores predeterminados" })).toBeTruthy();
    await act(async () => { await activateLocale("en-US"); });
    expect(view.getByRole("button", { name: "Reset to default" })).toBeTruthy();
  });

  test("a failed kit chunk never fails Home's activation", async () => {
    const instance = (await import("@lingui/core")).setupI18n({ locale: "en-US", messages: { "en-US": {} } });
    await activateLocale("es", undefined, { instance, loaders: { es: async () => ({ messages: { Search: "Buscar" } }) } });
    expect(instance.locale).toBe("es");
    expect(instance._("Search")).toBe("Buscar");
  });
});
