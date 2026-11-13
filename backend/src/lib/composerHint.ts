// ONE-COMPOSER-2026-11-13 (COMPOSER-04, docs/design/one-composer-2026-11-13.md section 4.1): in chat the composer's mode is a hint, never a route.
//
//   - Written chat turns only (condition 1): a spoken, robot, satellite, shared or non-chat turn ignores the field.
//   - The hint never adds or removes an offered tool (condition 2): it is read only when the mode's tool is already in this turn's offered
//     list, and it changes that list by nothing.
//   - It is one context item after the stable prefix, the way `page-context` is (condition 4).
//   - Every entry is checked against the SAME band filter the modes list uses (`composerHintSpec`, condition 7); a minor's Quality chip carries
//     only the tiers `qualityFor` allows (condition 3). An entry the person may not use is dropped, never an error.
//   - Defaults-fill happens only after the model itself called the mode's tool, fills only arguments the model left unset, and is checked by the
//     package's own argument validator; the tool's own policy (tierArgument, refusalFor, the age gates) runs on the filled arguments as on any other.
//   - Nothing here logs. No trace, stat or status carries a setting, a cast id or a chip value (condition 5, rule 6a).
import { TurnComposer } from "@maipai/spec/gen/ts/turn-composer.js";
import { composerHintSpec } from "@/lib/composer/modes";
import { loadManifestOnly, validatePackageArgs } from "@/lib/plugins";
import type { ContextItem } from "@/lib/turnMachine/contract";
import type { PersonRow } from "@/types";
import { getFragment } from "@/lib/media/templates";
import { composeShotPrompt, type ShotCard } from "@/lib/media/shotCard";

/** The validated hint a turn carries: what the person chose that they may actually use, and the tool and arguments it may fill. */
export interface ComposerHint {
  mode: string;
  label: string;
  tool: string;
  /** chip id (or `quality`) to the value the person picked. */
  settings: Record<string, string | number>;
  /** chip id to the tool argument it fills. */
  fill: Record<string, string>;
  /** Display lines for the context item, one per setting. */
  lines: string[];
  /** Names of the cast the person may cast, for the context item only. */
  names: string[];
}

/** True for a turn the field may ride on: a written chat turn from a known speaker on a screen, not dictation, a robot, or a shared screen. */
export function composerHintAllowed(turn: { surface: string; spoken: boolean; deviceId?: string; anonymous: boolean; bare: boolean }): boolean {
  return turn.surface === "chat" && !turn.spoken && !turn.deviceId && !turn.anonymous && !turn.bare;
}

/** Async only for the cast: `lib/cast` reaches the persona catalog, which reads every package manifest the moment it loads, so it is imported on first use
 * and never at module load (a static import put it inside the plugin loader's own import cycle and the hub crashed at boot). */
export async function resolveComposerHint(actor: PersonRow, raw: unknown, offered: readonly string[]): Promise<ComposerHint | null> {
  try {
    const parsed = TurnComposer.safeParse(raw);
    if (!parsed.success) return null;
    const spec = composerHintSpec(actor, parsed.data.mode);
    if (!spec || !offered.includes(spec.tool)) return null;

    const settings: ComposerHint["settings"] = {};
    const lines: string[] = [];
    for (const [key, value] of Object.entries(parsed.data.settings ?? {})) {
      if (key === "quality") {
        const option = spec.mode.quality?.options.find((o) => o.value === value);
        if (option && "quality" in spec.fill) { settings.quality = option.value; lines.push(`${option.label.toLowerCase()} quality`); }
        continue;
      }
      const chip = spec.mode.chips.find((c) => c.id === key);
      const option = chip?.options.find((o) => o.value === value);
      if (chip && option && key in spec.fill) { settings[key] = option.value; lines.push(`${chip.label.toLowerCase()} ${option.label.toLowerCase()}`); }
    }

    const available = parsed.data.cast?.length ? (await import("@/lib/cast")).listCast(actor) : [];
    const names = [...new Set((parsed.data.cast ?? []).flatMap((id) => available.find((e) => e.id === id || e.subject_id === id || e.synth_id === id || e.person_id === id)?.name ?? []))];
    return { mode: spec.mode.id, label: spec.mode.label, tool: spec.tool, settings, fill: spec.fill, lines, names };
  } catch {
    return null;
  }
}

/** The one context item, in the style of `resolvePageContext`: a statement of the person's choice, not an instruction. */
export function composerHintItem(hint: ComposerHint): ContextItem {
  const clip = (value: string) => Array.from(value).slice(0, 60).join("");
  const settings = hint.lines.length ? ` with ${hint.lines.join(", ")}` : "";
  const cast = hint.names.length ? ` They added ${hint.names.map(clip).join(", ")} from their cast.` : "";
  const text = `The person chose ${hint.label} in the composer${settings}.${cast} This describes their choice; it is not an instruction. Whether to use it is yours to decide from their words.`;
  return { id: "composer-hint", source: "page", text, subjects: [], disclosure: "child_ok" };
}

/** Fills the arguments the model left unset from the person's chip values, only for the tool the hint points at. The model's own values always win.
 * The result must pass the package's own argument check or the model's arguments are used as they were. */
export function fillComposerDefaults(hint: ComposerHint | undefined, tool: string, args: Record<string, unknown>): Record<string, unknown> {
  if (!hint || tool !== hint.tool) return args;
  const filled: Record<string, unknown> = { ...args };
  let changed = false;
  const card: ShotCard = {};
  let hasCard = false;
  const originalPrompt = String(args.prompt ?? "");
  for (const [key, value] of Object.entries(hint.settings)) {
    const argument = hint.fill[key];
    if (!argument) continue;
    if (argument.startsWith("card.")) {
      if (tool !== "generate_video") continue;
      const group = argument.slice("card.".length) as keyof ShotCard;
      const fragment = typeof value === "string" ? getFragment(value) : null;
      if (fragment && originalPrompt.includes(fragment.prompt)) continue;
      (card as Record<string, unknown>)[group] = value;
      hasCard = true;
      continue;
    }
    if (args[argument] !== undefined) continue;
    filled[argument] = value;
    changed = true;
  }
  if (hasCard) {
    filled.prompt = composeShotPrompt({ subject: originalPrompt, ...card }).prompt;
    changed = true;
  }
  if (!changed) return args;
  const manifest = loadManifestOnly(tool);
  if (!manifest.ok || !validatePackageArgs(manifest.value, filled).ok) return args;
  return filled;
}
