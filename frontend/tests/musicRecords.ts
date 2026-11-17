import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComposerModeRecord } from "@/shell/composer/composerModes";

// The hub's Song and Sound effect records as the modes route returns them, read from the one place they are defined (the audio
// package's composer.json), so a test never keeps its own copy of the chips.
type Node = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export function musicRecords(): ComposerModeRecord[] {
  const file = join(import.meta.dir, "../../backend/packages/audio/composer.json");
  const modes = (JSON.parse(readFileSync(file, "utf-8")) as { modes: Node[] }).modes;
  return modes.map((d): ComposerModeRecord => ({
    id: d.id, label: d.label, icon: d.icon, route: d.route, engine: "music", placeholder: d.fallback?.placeholder ?? "",
    references: (d.references ?? []).map((r: Node) => ({ id: r.state, label: r.label, kind: r.kind, ...(r.max ? { max: r.max } : {}) })),
    chips: (d.chips ?? []).map((c: Node) => ({
      id: c.state, label: c.label, ...(c.group ? { group: c.group } : {}), ...(c.icon ? { icon: c.icon } : {}), ...(c.icon_only ? { iconOnly: true } : {}),
      ...(c.quiet_value !== undefined ? { quiet: c.quiet_value } : {}), ...(c.disabled_when ? { disabledWhen: c.disabled_when } : {}), options: c.options, default: c.default,
    })),
    presets: null, tools: d.tools ?? [], primary: { label: d.fallback?.primary ?? d.label }, quality: null, availability: "ready", disabledReason: null, comingSoon: null,
  }));
}
