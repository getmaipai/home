import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { ResolvedSetting } from "@/lib/api";

export interface MergedSetting {
  def: SettingsKey;
  resolved: ResolvedSetting;
}

export interface SettingsGroup {
  id: string;
  basic: MergedSetting[];
  advanced: MergedSetting[];
  /** docs/SETTINGS.md Rule 4: advanced keys fold into one collapsed group
   * only once there are three or more in a section; fewer show inline. */
  foldAdvanced: boolean;
}

// No `section` is populated on any real registry key yet (both entries in
// spec/settings/keys.json omit it), so `lives_in` is the only grouping
// key available today; a real `section.order`/`collapsed` sort is a real,
// separate gap for whenever a key actually declares one.
const SECTION_TITLES: Record<string, string> = {
  "household.system": "System",
  "person.voice": "Voice",
  "person.persona": "Personality",
  // Not the same as ModelsSection.tsx's own "AI models" heading
  // (hardware/download management, a different component entirely) -
  // this is aiKeys.ts's own chat.* override keys (model, context size,
  // flash attention, KV cache precision), already found showing its raw
  // lives_in id the same way person.persona was before this fix, live in
  // the browser (2026-09-05).
  "household.ai": "AI model tuning",
  "household.integrations": "Integrations",
};

export function sectionTitle(id: string): string {
  return SECTION_TITLES[id] ?? id;
}

// docs/SETTINGS.md Rule 4: "three levels, disclosed locally, never a
// global mode." Expert is filtered out entirely here rather than shown
// anywhere: it "lives under Developer tools, admin only" and no such
// destination exists yet (deferred, docs/dev.md) - hiding it is honest,
// building a fake Developer Tools page to hold it would not be.
// honoured_by filters out keys declared for the robot only (docs/
// SETTINGS.md's registry shape: honoured_by names which product actually
// reads a key), which the real registry doesn't have yet but a future one
// will.
export function groupSettings(
  registry: SettingsKey[],
  values: ResolvedSetting[],
  scopeKind: "household" | "person" | "device",
): SettingsGroup[] {
  const valueByKey = new Map(values.map((v) => [v.key, v]));
  const eligible = registry.filter(
    (k) => k.scope === scopeKind && k.honoured_by.includes("home") && k.level !== "expert",
  );

  const groups = new Map<string, SettingsGroup>();
  for (const def of eligible) {
    const resolved = valueByKey.get(def.key);
    // A registry key with no resolved value (a scope mismatch between
    // /registry and /?scope=, or a key added after this fetch) is
    // skipped rather than rendered with a fabricated value.
    if (!resolved) continue;
    let group = groups.get(def.lives_in);
    if (!group) {
      group = { id: def.lives_in, basic: [], advanced: [], foldAdvanced: false };
      groups.set(def.lives_in, group);
    }
    const merged: MergedSetting = { def, resolved };
    if (def.level === "advanced") group.advanced.push(merged);
    else group.basic.push(merged);
  }
  for (const group of groups.values()) {
    group.foldAdvanced = group.advanced.length >= 3;
  }
  return [...groups.values()];
}
