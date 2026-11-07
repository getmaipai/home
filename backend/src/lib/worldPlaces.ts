import { WorldPlace } from "@maipai/spec/gen/ts/world-place.js";
import type { WorldPlace as WorldPlaceT } from "@maipai/spec/gen/ts/world-place.js";
import { worldPlaces } from "@/db/schema";
import { ownedRecordCrud } from "@/lib/ownedRecordCrud";
import type { PersonRow } from "@/types";

const places = ownedRecordCrud({
  table: worldPlaces, spec: WorldPlace, idPrefix: "place", fields: ["name", "country", "zone"], trimmed: ["name", "country"], blankDefaults: ["zone"],
  invalid: "world_place_invalid", missing: "world_place_missing",
  limit: { max: 12, code: "world_place_limit" },
  validate: (values) => {
    try { new Intl.DateTimeFormat("en", { timeZone: values.zone }); } catch { return "world_place_zone_invalid"; }
    return null;
  },
});

export const listWorldPlaces = (actor: PersonRow): WorldPlaceT[] => places.list(actor);

export const createWorldPlace = (actor: PersonRow, input: { name?: string; country?: string; zone?: string; position?: number; source?: "hub" | "local" }) => places.create(actor, input);

export const updateWorldPlace = (actor: PersonRow, id: string, edit: Partial<Pick<WorldPlaceT, "name" | "country" | "zone" | "position">>) => places.update(actor, id, edit);

export const deleteWorldPlace = (actor: PersonRow, id: string) => places.remove(actor, id);
