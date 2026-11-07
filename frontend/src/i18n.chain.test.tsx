import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { setupI18n } from "@lingui/core";
import { I18nProvider, Trans } from "@lingui/react";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLocale, catalogLoaders } from "@/i18n";
import { FALLBACK_LOCALES, fallbackChain, SUPPORTED_LOCALES } from "@/supportedLocales";

afterEach(cleanup);

const fresh = () => setupI18n({ locale: "en-US", messages: { "en-US": { Search: "Search", Today: "Today" } } });

describe("activateLocale", () => {
  test("a failed chunk keeps the app on en-US and logs once", async () => {
    const instance = fresh();
    const log = spyOn(console, "error").mockImplementation(() => {});
    await activateLocale("es", undefined, { instance, loaders: { es: () => Promise.reject(new Error("chunk 404")) } });
    expect(instance.locale).toBe("en-US");
    expect(instance._("Search")).toBe("Search");
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  test("a loaded locale activates and translates", async () => {
    const instance = fresh();
    await activateLocale("es", undefined, { instance, loaders: { es: async () => ({ messages: { Search: "Buscar" } }) } });
    expect(instance.locale).toBe("es");
    expect(instance._("Search")).toBe("Buscar");
  });

  test("an unknown locale falls back to en-US", async () => {
    const instance = fresh();
    await activateLocale("klingon", undefined, { instance, loaders: {} });
    expect(instance.locale).toBe("en-US");
  });

  test("a child mode locale shows its chain, nearest first", async () => {
    const instance = fresh();
    await activateLocale("es", "child", { instance, loaders: { es: async () => ({ messages: { Search: "Buscar" } }) } });
    expect(instance.locale).toBe("es-x-child");
    expect(instance._("Search")).toBe("Buscar");
  });

  test("the real es and en-GB chunks load and Search and Today still translate", async () => {
    const es = (await catalogLoaders.es!()).messages as Record<string, unknown>;
    expect(es.Search).toBeTruthy();
    const instance = setupI18n({ locale: "es", messages: { es: es as never } });
    expect(instance._("Search")).toBe("Buscar");
    expect(instance._("Today")).toBe("Hoy");
    const gb = (await catalogLoaders["en-GB"]!()).messages as Record<string, unknown>;
    expect(Object.keys(gb)).toContain("Search");
  });
});

describe("chain order", () => {
  test("the chains of section 5", () => {
    expect(fallbackChain("en-GB")).toEqual(["en-GB", "en-US"]);
    expect(fallbackChain("es")).toEqual(["es", "en-US"]);
    expect(fallbackChain("en-US")).toEqual(["en-US"]);
    expect(fallbackChain("en-GB", "child")).toEqual(["en-GB-x-child", "en-GB", "en-US"]);
    expect(fallbackChain("es", "teen")).toEqual(["es-x-teen", "es", "en-US"]);
    expect(fallbackChain("en-US", "child")).toEqual(["en-US-x-child", "en-US"]);
    expect(fallbackChain("fr")).toEqual(["en-US"]);
  });
});

describe("fallbackLocales honoured by the Lingui compile", () => {
  test("an untranslated es id compiles to English and renders as English", async () => {
    const requireFromCli = createRequire(createRequire(import.meta.url).resolve("@lingui/cli"));
    const { makeConfig } = requireFromCli("@lingui/conf");
    const { getCatalogs, createCompiledCatalog } = await import("@lingui/cli/api");
    const dir = mkdtempSync(join(tmpdir(), "maipai-i18n-compile-"));
    try {
      const po = (locale: string, entries: Record<string, string>) => {
        mkdirSync(join(dir, locale), { recursive: true });
        const body = Object.entries(entries).map(([id, str]) => `#. js-lingui-explicit-id\nmsgid ${JSON.stringify(id)}\nmsgstr ${JSON.stringify(str)}\n`).join("\n");
        writeFileSync(join(dir, locale, "messages.po"), `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=utf-8\\n"\n"Language: ${locale}\\n"\n\n${body}`);
      };
      po("en-US", { Search: "Search", Today: "Today" });
      po("en-GB", {});
      po("es", { Search: "Buscar", Today: "" });
      const config = makeConfig(
        { rootDir: dir, locales: [...SUPPORTED_LOCALES], sourceLocale: "en-US", fallbackLocales: FALLBACK_LOCALES, catalogs: [{ path: join(dir, "{locale}/messages"), include: [dir] }] },
        { skipValidation: true },
      );
      const catalogs = await getCatalogs(config);
      const { messages } = await catalogs[0]!.getTranslations("es", { fallbackLocales: config.fallbackLocales, sourceLocale: config.sourceLocale });
      expect(messages.Search).toBe("Buscar");
      expect(messages.Today).toBe("Today");
      const { source } = createCompiledCatalog("es", messages, { namespace: "es" });
      const compiled = new Function(`${source.replace("export const messages", "const messages")}; return messages;`)();
      const instance = setupI18n({ locale: "es", messages: { es: compiled } });
      const { getByText } = render(<I18nProvider i18n={instance}><Trans id="Today" message="Today" /></I18nProvider>);
      expect(getByText("Today")).toBeTruthy();
      expect(instance._("Search")).toBe("Buscar");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
