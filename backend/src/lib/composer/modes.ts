// ONE-COMPOSER-2026-11-13 (COMPOSER-03): the composer's modes as data. One place decides which modes a person is offered, and every
// composer (the Home ask box, the Create pages) reads it through GET /api/composer/modes.
//
//   - Content: a package's Create page `prompt_bar` node says what the mode shows (placeholder, reference slots, chips, tiers, button
//     words); `packages/<id>/composer.json` adds only what the node cannot (id, label, icon, engine, gate, tools, presets). Nothing is
//     defined twice. The schema node has no `modes` field yet (additionalProperties is false in spec 0.1.378), so the descriptor sits
//     beside the page, not inside it.
//   - Who may see a mode: the SAME policy functions beginTurn's tool gates call (`picturesAllowed`, `videosAllowed`, `musicsAllowed`
//     with the route audience), plus the page's own floor (`getAppPage`). A mode is a choice of tool the person may already use.
//   - Readiness: only `roleHealth` through the health snapshot (`collectHealth`), the row's own per-band notice. It is a reading
//     at request time for non-React callers; the web composer reads the live `["health"]` query itself and never polls this route.
//   - Quality: Standard always; Boost and Max only where `authorizeTier` and `maxOffered` allow this person (resource-tiers).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { getAppPage } from "@/lib/apps";
import { collectHealth } from "@/lib/healthSnapshot";
import { listTemplates } from "@/lib/media/templates";
import { musicsAllowed } from "@/lib/music/policy";
import { routeAudience } from "@/lib/pictures/audience";
import { picturesAllowed } from "@/lib/pictures/policy";
import { resolvePackageDir } from "@/lib/packageResolve";
import { authorizeTier, maxOffered, type TierCategory } from "@/lib/tiers";
import { videosAllowed } from "@/lib/videos/policy";
import type { PersonRow } from "@/types";

export type ComposerEngine = "image" | "video" | "music" | "voices";
export type ComposerTool = "clear" | "improve" | "lyrics";

export interface ComposerModeChip { id: string; label: string; group?: string; icon?: string; iconOnly?: boolean; /** While this value is chosen the chip adds nothing to its popover trigger (an "Auto" or "None" start), so the trigger reads the group name. */ quiet?: string | number; options: Array<{ value: string | number; label: string; detail?: string; icon?: string }>; default: string | number }
export interface ComposerModeRecord {
  id: string;
  label: string;
  icon: string;
  /** The page (an app route) this mode's Create composer lives on; null for chat. */
  route: string | null;
  engine: ComposerEngine | null;
  placeholder: string;
  references: Array<{ id: string; label: string; kind: "picture" | "character" | "place" | "audio" | "video"; max?: number }>;
  chips: ComposerModeChip[];
  presets: { label: string; chips: Array<{ id: string; label: string; options: Array<{ value: string; label: string; text: string }>; default: string }> } | null;
  tools: ComposerTool[];
  primary: { label: string };
  quality: { default: string; options: Array<{ value: string; label: string; detail?: string }> } | null;
  /** The reading of the engine's health row at request time (null for chat). The web composer reads the live health query instead. */
  availability: "ready" | "starting" | "unavailable" | null;
  disabledReason: string | null;
  /** A page whose route is not built yet: the one plain line its primary button shows while it stays disabled. Null for every working mode. */
  comingSoon: string | null;
}
export interface ComposerModesResponse { band: AgeBand; modes: ComposerModeRecord[] }

interface Descriptor {
  id: string; label: string; icon: string; page: string; route: string; engine: ComposerEngine;
  gate: "pictures" | "videos" | "music"; tier_category?: TierCategory; tools?: ComposerTool[];
  presets?: { label?: string; source: "templates"; kind: "picture" | "video" };
  fallback?: { placeholder?: string; primary?: string };
  /** The plain line that replaces the primary button's action while no backend route exists for this mode (never a dead control, never hidden). */
  coming_soon?: string;
  /** COMPOSER-04: the one tool a chat hint for this mode may fill, and which chip (or `quality`) fills which of its arguments. Chat only; never an offer. */
  chat_tool?: string;
  chat_args?: Record<string, string>;
}

/** The Chat mode: the person's own chat, today's behaviour, always first. It belongs to no package. */
const CHAT_MODE: ComposerModeRecord = {
  id: "ask", label: "Ask", icon: "message-circle", route: null, engine: null, placeholder: "Ask anything", references: [], chips: [], presets: null, tools: [],
  primary: { label: "Send" }, quality: null, availability: null, disabledReason: null, comingSoon: null,
};

function readDescriptors(packageId: string): Descriptor[] {
  try {
    const file = join(resolvePackageDir(packageId), "composer.json");
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as { modes?: Descriptor[] };
    return Array.isArray(parsed.modes) ? parsed.modes : [];
  } catch { return []; }
}

type Node = Record<string, unknown>;
function findPromptBar(value: unknown): Node | null {
  if (!value || typeof value !== "object") return null;
  const node = value as Node;
  if (node.type === "prompt_bar") return node;
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) { for (const item of child) { const hit = findPromptBar(item); if (hit) return hit; } }
    else { const hit = findPromptBar(child); if (hit) return hit; }
  }
  return null;
}

function text(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }

function chipsOf(bar: Node): ComposerModeChip[] {
  const chips = Array.isArray(bar.chips) ? bar.chips as Node[] : [];
  return chips.flatMap((chip): ComposerModeChip[] => {
    const options = (Array.isArray(chip.options) ? chip.options as Node[] : []).flatMap((o) => (typeof o.value === "string" || typeof o.value === "number") && text(o.label) ? [{ value: o.value, label: o.label as string, ...(text(o.icon) ? { icon: text(o.icon)! } : {}) }] : []);
    const id = text(chip.state), label = text(chip.label);
    if (!id || !label || options.length === 0) return [];
    const group = text(chip.group);
    const quiet = typeof chip.quiet_value === "string" || typeof chip.quiet_value === "number" ? chip.quiet_value : undefined;
    const icon = text(chip.icon);
    return [{ id, label, ...(group ? { group } : {}), ...(icon ? { icon } : {}), ...(chip.icon_only === true ? { iconOnly: true } : {}), ...(quiet !== undefined ? { quiet } : {}), options, default: (chip.default as string | number | undefined) ?? options[0]!.value }];
  });
}

/** The tiers this person may pick in this category: Standard always, Boost and Max only where the one tier policy allows them. */
export function qualityFor(person: PersonRow, band: AgeBand, category: TierCategory, bar: Node): ComposerModeRecord["quality"] {
  const tier = bar.tier as { default?: string; tiers?: Array<{ id: string; label: string; hint?: string }> } | undefined;
  if (!tier?.tiers) return null;
  const allowed = (id: string): boolean => id === "standard" || (id === "boost" && authorizeTier({ person, category, requested: "boost", band }).tier !== "standard") || (id === "max" && maxOffered(person, category, band));
  const options = tier.tiers.filter((t) => allowed(t.id)).map((t) => ({ value: t.id, label: t.label, ...(t.hint ? { detail: t.hint } : {}) }));
  if (options.length < 2) return null;
  return { default: options.some((o) => o.value === tier.default) ? tier.default! : options[0]!.value, options };
}

/** `{{name|label|default}}` blanks of a template, filled with their default (else their label) so the Presets list can start the words. */
function startingWords(prompt: string): string {
  return prompt.replace(/\{\{[a-z][a-z0-9_]*\|([^|}]+)\|([^}]*)\}\}/g, (_whole, label: string, fallback: string) => (fallback.trim() || label).trim());
}

function presetsOf(person: PersonRow, d: Descriptor): ComposerModeRecord["presets"] {
  if (!d.presets) return null;
  const rows = listTemplates({ actor: person, kind: d.presets.kind });
  if (rows.length === 0) return null;
  return { label: d.presets.label ?? "Presets", chips: [{ id: "template", label: "Templates", default: "", options: rows.map((row) => ({ value: row.id, label: row.title, text: startingWords(row.prompt) })) }] };
}

const PACKAGES = ["image", "video", "audio"] as const;

type EngineHealth = Awaited<ReturnType<typeof collectHealth>>["engines"];

function buildModes(person: PersonRow, health: EngineHealth | null): { band: AgeBand; modes: ComposerModeRecord[]; descriptors: Map<string, Descriptor> } {
  const band = speakerAgeBand(person, new Date());
  const audience = routeAudience(person);
  const allowed: Record<Descriptor["gate"], boolean> = {
    pictures: picturesAllowed(audience),
    videos: videosAllowed(audience),
    music: musicsAllowed(audience),
  };
  const modes: ComposerModeRecord[] = [CHAT_MODE];
  const descriptors = new Map<string, Descriptor>();
  for (const packageId of PACKAGES) {
    for (const d of readDescriptors(packageId)) {
      if (!allowed[d.gate]) continue;
      const page = getAppPage(person, packageId, d.page);
      if (!page.ok) continue;
      const bar = findPromptBar(page.value) ?? {};
      const row = health?.[d.engine];
      const references = (Array.isArray(bar.references) ? bar.references as Node[] : []).flatMap((ref) => text(ref.state) && text(ref.label) && text(ref.kind) ? [{ id: ref.state as string, label: ref.label as string, kind: ref.kind as "picture", ...(ref.placement === "in_field" ? { max: 1 } : typeof ref.max === "number" ? { max: ref.max } : {}) }] : []);
      const notice = row?.notice;
      descriptors.set(d.id, d);
      modes.push({
        id: d.id, label: d.label, icon: d.icon, route: d.route, engine: d.engine,
        placeholder: text(bar.placeholder) ?? d.fallback?.placeholder ?? "",
        references, chips: chipsOf(bar), presets: presetsOf(person, d), tools: d.tools ?? [],
        primary: { label: text(bar.submit_label) ?? d.fallback?.primary ?? d.label },
        quality: d.tier_category ? qualityFor(person, band, d.tier_category, bar) : null,
        availability: row?.availability ?? null,
        disabledReason: row && row.availability !== "ready" && notice ? (band === "adult" ? notice.adult : band === "teen" ? notice.teen : notice.child) : null,
        comingSoon: d.coming_soon ?? null,
      });
    }
  }
  return { band, modes, descriptors };
}

/** The modes this person is offered, in the order Ask, Picture, Video, Song. */
export async function composerModesFor(person: PersonRow): Promise<ComposerModesResponse> {
  const health = await collectHealth().then((snapshot) => snapshot.engines, () => null);
  const { band, modes } = buildModes(person, health);
  return { band, modes };
}

/** COMPOSER-04: what a chat hint for `modeId` may do for this person, from the SAME band filter as the modes list (no health read, nothing awaited).
 * null when the mode is unknown, plain chat, not allowed for this person, or has no chat tool. */
export function composerHintSpec(person: PersonRow, modeId: string): { mode: ComposerModeRecord; tool: string; fill: Record<string, string> } | null {
  const { modes, descriptors } = buildModes(person, null);
  const mode = modes.find((m) => m.id === modeId), d = descriptors.get(modeId);
  if (!mode || !d?.chat_tool) return null;
  return { mode, tool: d.chat_tool, fill: d.chat_args ?? {} };
}
