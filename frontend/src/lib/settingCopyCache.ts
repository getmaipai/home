// I18N-F3: the kit's settings renderer (@maipai/ui, K1 not yet extracted) draws label, help, option and reason text exactly as the
// server sends it. Home hands it translated copy by rewriting the two shared query caches in place: the registry
// (["settings-registry"]) and the resolved values (["settings-values", scope]). The English original is kept beside each
// translated array, so a language change re-translates from the source and never from a translation.
import { i18n } from "@lingui/core";
import type { QueryClient } from "@tanstack/react-query";
import { SETTING_COPY } from "./settingCopy.generated";
import { settingDoes, settingHelp, settingLabel, settingReason, settingState, settingText } from "./settingCopy";

type Def = { key: string; label: string; help?: string; copy?: Record<string, unknown>; range?: { options?: string[] } };
type Value = { key: string; label?: string; help?: string; does?: string; state?: string; reason?: string };

const COPY_STRINGS = ["does", "does_child", "does_teen", "title", "what_is_stored", "consent_adult_self", "consent_teen_self", "consent_child_parent", "consent_guest"];

export function translateRegistry(defs: readonly Def[]): Def[] {
  return defs.map((def) => {
    const copy = def.copy ? { ...def.copy } : undefined;
    if (copy) {
      for (const field of COPY_STRINGS) if (typeof copy[field] === "string") copy[field] = settingText(def.key, field, copy[field] as string);
      if (copy.options) copy.options = Object.fromEntries(Object.entries(copy.options as Record<string, string>).map(([value, text]) => [value, settingText(def.key, `option.${value}`, text)]));
    }
    // The kit names an option from `option_labels`, else a title-cased id; hand it the translated name when there is one.
    const labels: Record<string, string> = { ...((def.copy?.option_labels as Record<string, string> | undefined) ?? {}) };
    for (const value of def.range?.options ?? []) {
      const entry = SETTING_COPY[`setting.${def.key}.option_label.${value}`];
      if (entry) {
        const translated = entry.t();
        if (translated !== entry.en || labels[value] !== undefined) labels[value] = translated;
      }
    }
    const withLabels = Object.keys(labels).length ? { ...(copy ?? {}), option_labels: labels } : copy;
    return { ...def, label: settingLabel(def), ...(def.help !== undefined ? { help: settingHelp(def) } : {}), ...(withLabels ? { copy: withLabels } : {}) };
  });
}

export function translateValues<T extends Value>(values: readonly T[], defs: readonly Def[]): T[] {
  const byKey = new Map(defs.map((def) => [def.key, def]));
  return values.map((value) => {
    const def = byKey.get(value.key);
    if (!def) return value;
    return {
      ...value,
      ...(value.label !== undefined ? { label: settingLabel({ ...def, label: value.label }) } : {}),
      ...(value.help !== undefined ? { help: settingText(def.key, "help", value.help) } : {}),
      ...(value.does !== undefined ? { does: settingDoes(def, value.does) } : {}),
      ...(value.state !== undefined ? { state: settingState(value.state) } : {}),
      ...(value.reason !== undefined ? { reason: settingReason(value.reason) } : {}),
    };
  });
}

const sources = new WeakMap<object, { source: unknown[]; locale: string }>();

export function installSettingCopyCache(queryClient: QueryClient): () => void {
  let writing = false; // our own writes raise cache events; they must not re-enter
  const registryDefs = (): Def[] => {
    const cached = queryClient.getQueryData<Def[]>(["settings-registry"]);
    return cached ? ((sources.get(cached)?.source as Def[] | undefined) ?? cached) : [];
  };
  const apply = (queryKey: readonly unknown[], force = false) => {
    const name = queryKey[0];
    if (name !== "settings-registry" && name !== "settings-values") return;
    const data = queryClient.getQueryData<unknown[]>(queryKey);
    if (!Array.isArray(data)) return;
    const known = sources.get(data);
    if (known && known.locale === i18n.locale && !force) return;
    const source = known?.source ?? data;
    const next = name === "settings-registry" ? translateRegistry(source as Def[]) : translateValues(source as Value[], registryDefs());
    writing = true;
    try { queryClient.setQueryData(queryKey, next); } finally { writing = false; }
    // Structural sharing may keep a different array than `next`; remember the one that is actually cached.
    const landed = queryClient.getQueryData<unknown[]>(queryKey);
    if (landed) sources.set(landed, { source, locale: i18n.locale });
  };
  const retranslateAll = () => {
    // The registry first: the values are translated against its English definitions.
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ["settings-registry"] })) apply(query.queryKey, true);
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ["settings-values"] })) apply(query.queryKey, true);
  };
  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    if (writing || event.type !== "updated" || event.action.type !== "success") return;
    if (event.query.queryKey[0] === "settings-registry") { if (!sources.has(event.query.state.data as object)) retranslateAll(); return; }
    apply(event.query.queryKey);
  });
  const unsubscribeLocale = i18n.on("change", retranslateAll);
  retranslateAll();
  return () => { unsubscribeCache(); unsubscribeLocale(); };
}
