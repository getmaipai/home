import { i18n, type I18n } from "@lingui/core";
import { loadKitCatalog } from "@maipai/ui/src/i18n";
import { messages as messagesEnUS } from "@/locales/en-US/messages.po";
import { fallbackChain, SUPPORTED_LOCALES, type SupportedLocale } from "@/supportedLocales";

i18n.load("en-US", { ...messagesEnUS });
i18n.activate("en-US");

export type CatalogLoader = () => Promise<{ messages: Parameters<I18n["load"]>[1] }>;

// One chunk per locale. Each compiled file already holds its fallback chain's entries (the Vite compile reads
// `fallbackLocales` from lingui.config.ts), so an untranslated id arrives as English, never as a key.
export const catalogLoaders: Record<string, CatalogLoader> = {
  "en-GB": () => import("@/locales/en-GB/messages.po"),
  es: () => import("@/locales/es/messages.po"),
};

/** Load the locale's chain, then activate it. A failed chunk keeps the app on en-US and logs once; translation trouble never breaks a screen. */
export async function activateLocale(
  locale: string,
  mode?: "child" | "teen",
  options: { instance?: I18n; loaders?: Record<string, CatalogLoader> } = {},
): Promise<void> {
  const target = options.instance ?? i18n;
  const loaders = options.loaders ?? catalogLoaders;
  const base = (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? locale : "en-US";
  try {
    const loaded: Record<string, Parameters<I18n["load"]>[1]> = { "en-US": messagesEnUS };
    const chain = [...new Set(fallbackChain(base, mode))];
    // Real files first, then the -x- mode locales that are built from them.
    for (const id of [...chain].sort((a, b) => Number(a.includes("-x-")) - Number(b.includes("-x-")))) {
      if (id === "en-US") continue;
      const load = loaders[id];
      if (load) {
        loaded[id] = (await load()).messages;
        target.load(id, loaded[id]);
      } else if (id.includes("-x-")) {
        // No -x- file yet (KID-MODE-04): the mode locale shows its chain's entries, nearest first.
        const merged = chain.slice(1).reverse().reduce((all, next) => ({ ...all, ...(loaded[next] ?? {}) }), {});
        target.load(id, merged);
      }
    }
    // After Home's own entries: a mode locale's merged Home table must not stand over the kit's text. The kit's ids start with "ui.", so
    // they never collide with Home's; a failed kit load leaves the kit in English and never fails Home's activation (loadKitCatalog does not throw).
    for (const id of chain) await loadKitCatalog(id, target);
    target.activate(mode ? `${base}-x-${mode}` : base);
  } catch (error) {
    console.error("[i18n] catalog load failed; using en-US", error);
    target.activate("en-US");
  }
}

export type { SupportedLocale };
export { i18n };
