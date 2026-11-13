// Image app shelves read templates and files through their existing access boundaries.
import { listLibrary } from "@/lib/library";
import { listTemplates } from "@/lib/media/templates";
import { registerAppData } from "@/lib/apps";
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
