// Image app shelves read templates and files through their existing access boundaries.
import { listLibrary } from "@/lib/library";
import { listTemplates } from "@/lib/media/templates";
import { registerAppData, registerAppPageFill } from "@/lib/apps";
import { pictureFragmentChips } from "@/lib/media/pictureFragments";
import { studioOperationRows, studioPickerRows, studioRows } from "@/lib/mediaOps/studio";
import type { PersonRow } from "@/types";

const rows = (person: PersonRow, body: unknown, madeOnly = false) => {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const limit = Math.min(60, Math.max(1, Number.isInteger(input.limit) ? Number(input.limit) : 20));
  const page = listLibrary(person, { type: "image", ...(madeOnly ? { origin: "made" as const } : {}), sort: "newest", limit });
  return page.items.map((file) => ({ id: file.id, title: file.name, subtitle: file.owner.display_name, thumbnail: file.thumb_url, kind: "image", created_at: file.created_at }));
};

export function imageAppData(person: PersonRow, dataId: string, body: unknown): unknown | null {
  if (dataId === "templates") return listTemplates({ actor: person, kind: "picture" }).map((template) => ({ id: template.id, title: template.title, subtitle: template.summary, summary: template.summary, thumbnail: null }));
  if (dataId === "library") return rows(person, body);
  if (dataId === "recent") return rows(person, body, true);
  // IMG-STUDIO-02: the Studio page. `studio` is the opened picture (one row, empty until a picture is chosen), `studio-tools` the registry's extra operations
  // for it, `studio-picker` the person's own pictures to choose from.
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (dataId === "studio") return studioRows(person, input);
  if (dataId === "studio-tools") return studioOperationRows(person, input);
  if (dataId === "studio-picker") return studioPickerRows(person, input);
  return null;
}
registerAppData("image", imageAppData);

/** CREATOR-13: the Create page's preset chips (Look by family, Light, Angle, Format), from the preset records. A Create page chip holds at most 24 options,
 * and each chip is its own popover (the kit's popover has no height limit, so one popover over all 79 options is 3,100 px tall and cannot be reached).
 * The composer's mode list reads this page's chips, so the Home ask box and every other composer show the same ones. The submit line names the chosen ones. */
registerAppPageFill("image", "create", (person, page) => {
  const bar = findPromptBar(page.body);
  if (!bar) return;
  const chips = pictureFragmentChips(person);
  if (chips.length === 0) return;
  const existing = Array.isArray(bar.chips) ? bar.chips as unknown[] : [];
  for (const item of existing) if (item && typeof item === "object") {
    const chip = item as Record<string, unknown>;
    if (chip.state === "shape") chip.icon = "crop";
  }
  bar.chips = [...existing, ...chips.map((chip) => ({ state: chip.id, label: chip.label, group: "Style", icon: chip.id.startsWith("look_") ? "palette" : "sparkles", presentation: "popover", default: "none", quiet_value: "none", options: chip.options }))];
  const ask = (bar.submit as { ask?: { prompt?: string } } | undefined)?.ask;
  if (ask?.prompt) ask.prompt = `${ask.prompt}\nPresets, where none means not chosen: ${chips.map((chip) => `${chip.id.startsWith("look_") ? "look" : chip.id} {${chip.id}}`).join(", ")}. Pass any chosen ones in the presets argument.`;
});
function findPromptBar(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) { for (const item of value) { const hit = findPromptBar(item); if (hit) return hit; } return undefined; }
  if (!value || typeof value !== "object") return undefined;
  const node = value as Record<string, unknown>;
  if (node.type === "prompt_bar") return node;
  for (const child of Object.values(node)) { const hit = findPromptBar(child); if (hit) return hit; }
  return undefined;
}
