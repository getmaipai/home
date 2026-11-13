import { i18n } from "@lingui/core";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ComposerQualityData, ComposerModeData } from "@maipai/ui/src/elements/composer-parts";
import type { PromptBarMode } from "@maipai/ui/src/elements/prompt-bar";
import { api } from "@/lib/api";
import { makingAvailability, type MakingKind } from "@/apps/chat/useMakingAvailability";
import { useHealthQuery } from "@/apps/chat/useChatAvailability";

// ONE-COMPOSER-2026-11-13 (COMPOSER-03): the one reading of `GET /api/composer/modes` and the one mapping from that data to the kit
// composer's `modes`, used by the Home ask box and every Create page host. Hand-copied from backend lib/composer/modes.ts (that file
// has "@/" imports of its own); the route's zod schema is the contract.

export interface ComposerChipRecord { id: string; label: string; group?: string; icon?: string; iconOnly?: boolean; quiet?: string | number; options: Array<{ value: string | number; label: string; detail?: string; icon?: string }>; default: string | number }
export interface ComposerModeRecord {
  id: string; label: string; icon: string; route: string | null; engine: MakingKind | null; placeholder: string;
  references: Array<{ id: string; label: string; kind: "picture" | "character" | "place" | "audio" | "video"; max?: number }>;
  chips: ComposerChipRecord[];
  presets: { label: string; chips: Array<{ id: string; label: string; options: Array<{ value: string; label: string; text: string }>; default: string }> } | null;
  tools: Array<"clear" | "improve" | "lyrics">;
  primary: { label: string };
  quality: { default: string; options: Array<{ value: string | number; label: string; detail?: string }> } | null;
  availability: "ready" | "starting" | "unavailable" | null;
  disabledReason: string | null;
  /** A mode whose page has no route behind it yet: the one plain line its primary shows while disabled. */
  comingSoon?: string | null;
}
export interface ComposerModesResponse { band: "child" | "teen" | "adult"; modes: ComposerModeRecord[] }

export const COMPOSER_MODES_KEY = ["composer-modes"] as const;

/** Chat alone, until the hub has answered (a composer never waits on the list to be usable). */
const ASK_ONLY: ComposerModesResponse = {
  band: "child",
  modes: [{ id: "ask", label: "Ask", icon: "message-circle", route: null, engine: null, placeholder: "Ask anything", references: [], chips: [], presets: null, tools: [], primary: { label: "Send" }, quality: null, availability: null, disabledReason: null }],
};

/** The modes this person may use. Refetched on mount and on focus once it is 30 seconds old, so a tab never shows old modes for long;
 * it is a plain read, not a status poll (no interval), and readiness is not in it (the live health query has that). */
export function useComposerModes(): ComposerModesResponse {
  const query = useQuery({ queryKey: COMPOSER_MODES_KEY, queryFn: api.composerModes, retry: false, staleTime: 30_000, refetchOnMount: true, refetchOnWindowFocus: true });
  // An answer that is not a mode list (an older hub, a stubbed fetch) reads as Ask alone, never as a crash.
  const data = query.data;
  return data && Array.isArray(data.modes) && data.modes.length > 0 ? data : ASK_ONLY;
}

/** Words the catalogs already know (a mode's label, a chip's name): the English text is its own id in Home's catalogs, so a known
 * word comes back translated and an unknown one comes back as it is. */
export const words = (text: string): string => i18n._({ id: text, message: text });

/** Where a composer sends its words: the mode's own Create page with the words and every chip value in the address (the page reads
 * its query as page state, so its chips start where the person left them), or Chat with the words unsent for the Ask mode. */
export function composerHref(route: string | null, text: string, settings: Record<string, string | number> = {}): string {
  const words = text.trim();
  if (route === null) return `/chat?ask=${encodeURIComponent(words)}`;
  const query = new URLSearchParams({ prompt: words });
  for (const [key, value] of Object.entries(settings)) query.set(key, String(value));
  return `${route}?${query.toString()}`;
}

/** The coming-soon line of the Create page this path is, if its mode has no route behind it yet (the page's bar shows it as its not-ready line). */
export function comingSoonFor(response: ComposerModesResponse, pathname: string): string | undefined {
  return response.modes.find((m) => m.route !== null && m.route === pathname)?.comingSoon ?? undefined;
}

export interface ComposerState {
  mode: string;
  setMode: (id: string) => void;
  /** The current mode's chip values by chip id, then Quality under `tier`. */
  settings: Record<string, string | number>;
  kitModes: PromptBarMode[];
  quality: ComposerQualityData | undefined;
  /** The S6 line (read from the live health query) while the current mode's engine is not ready; the bar disables Send and shows it. */
  disabledReason: string | undefined;
  current: ComposerModeRecord;
}

/** The kit composer's props for the current mode, from the data. Readiness is read from the existing `["health"]` query only. */
export function useComposerState(response: ComposerModesResponse, setText: (text: string) => void, initialMode = "ask"): ComposerState {
  const [picked, setMode] = useState(initialMode);
  const [chosen, setChosen] = useState<Record<string, string | number>>({});
  const health = useHealthQuery().data?.engines;
  const mode = response.modes.some((m) => m.id === picked) ? picked : response.modes[0]!.id;
  const current = response.modes.find((m) => m.id === mode)!;
  const valueOf = useCallback((id: string, key: string, fallback: string | number) => chosen[`${id}.${key}`] ?? fallback, [chosen]);
  const kitModes = useMemo<PromptBarMode[]>(() => response.modes.map((m): PromptBarMode => ({
    id: m.id,
    label: words(m.label),
    icon: m.icon as ComposerModeData["icon"],
    primaryLabel: words(m.primary.label),
    placeholder: words(m.placeholder),
    references: m.references.map((r) => ({ id: r.id, label: r.label, kind: r.kind, ...(r.max ? { max: r.max } : {}) })),
    chips: m.chips.map((c) => ({
      id: c.id, label: c.label, ...(c.group ? { group: c.group } : {}), ...(c.icon ? { icon: c.icon as never } : {}), ...(c.iconOnly ? { iconOnly: true } : {}), ...(c.quiet !== undefined ? { quietValue: c.quiet } : {}),
      options: c.options.map((o) => ({ value: o.value, label: o.label, ...(o.detail ? { detail: o.detail } : {}), ...(o.icon ? { icon: o.icon as never } : {}) })),
      value: valueOf(m.id, c.id, c.default),
      onValueChange: (value: string | number) => setChosen((all) => ({ ...all, [`${m.id}.${c.id}`]: value })),
    })),
    ...(m.presets ? { presets: { label: m.presets.label, chips: m.presets.chips.map((c) => ({
      id: c.id, label: c.label,
      options: c.options.map((o) => ({ value: o.value, label: o.label })),
      value: c.default,
      // A preset starts the words; it never starts a job (the Phosphene rule: a pick fills the form).
      onValueChange: (value: string | number) => { const row = c.options.find((o) => o.value === value); if (row) setText(row.text); },
    })) } } : {}),
    tools: m.tools,
  })), [response, valueOf, setText]);
  const quality = useMemo<ComposerQualityData | undefined>(() => current.quality ? {
    value: String(valueOf(current.id, "tier", current.quality.default)),
    onValueChange: (value) => setChosen((all) => ({ ...all, [`${current.id}.tier`]: value })),
    options: current.quality.options.map((o) => ({ value: String(o.value), label: o.label, ...(o.detail ? { detail: o.detail } : {}) })),
    band: response.band,
  } : undefined, [current, response.band, valueOf]);
  const settings = useMemo(() => {
    const out: Record<string, string | number> = {};
    for (const c of current.chips) out[c.id] = valueOf(current.id, c.id, c.default);
    if (current.quality) out.tier = valueOf(current.id, "tier", current.quality.default);
    return out;
  }, [current, valueOf]);
  const entry = current.engine ? health?.[current.engine] : undefined;
  const reading = current.engine ? makingAvailability(entry, { age_band: response.band }) : null;
  return { mode, setMode, settings, kitModes, quality, disabledReason: reading?.disabled ? reading.reason ?? words("Getting ready, one moment") : undefined, current };
}

/** The host's `composer` for a Create page (kit `MediaHost.composer`): the modes from the hub's list, the mode whose page this is, and the
 * hand-off to another mode's page with the words typed so far. Undefined away from a Create page, or when the person has one mode only,
 * so every other page keeps its bar unchanged. */
export function composerHostFor(response: ComposerModesResponse, pathname: string, go: (to: string) => void, search = "") {
  const current = response.modes.find((m) => m.route !== null && m.route === pathname);
  if (!current || response.modes.length < 2) return undefined;
  return {
    modes: response.modes.map((m) => ({ id: m.id, label: words(m.label), icon: m.icon, primaryLabel: words(m.primary.label) })),
    current: current.id,
    onModeChange: (id: string, draft: { text: string }) => {
      const next = response.modes.find((m) => m.id === id);
      if (next && id !== current.id) go(composerHref(next.route, draft.text));
    },
    ...(current.quality ? { quality: current.quality.options.map((o) => String(o.value)) } : {}),
    ...(current.presets ? { presets: { label: words(current.presets.label), chips: current.presets.chips.map((c) => ({ id: c.id, label: words(c.label), options: c.options.map((o) => ({ value: o.value, label: words(o.label) })), value: c.default, onValueChange: (value: string | number) => { const option = c.options.find((o) => o.value === value); if (option) { const settings = Object.fromEntries(Array.from(new URLSearchParams(search)).filter(([key]) => key !== "prompt")); go(composerHref(current.route, option.text, settings)); } } })) } } : {}),
  };
}
