import { and, eq, isNull } from "drizzle-orm";
import type { Entity as EntityT } from "@maipai/spec/gen/ts/entity.js";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { getEntity, listEntities } from "@/lib/entities";
import type { PersonRow } from "@/types";
import { childSafeAreaLabel } from "@/lib/placePrivacy";

export type PlaceSurface = "weather" | "maps";
export interface CurrentCoordinates { lat: number; lon: number; area?: string | null }
export interface ResolvedPlace {
  label: string;
  area: string | null;
  lat: number | null;
  lon: number | null;
  precision: "exact" | "area" | null;
  from: "named" | "saved" | "current" | "household" | "none";
}

const emptyPlace = (): ResolvedPlace => ({ label: "", area: null, lat: null, lon: null, precision: null, from: "none" });

function childSafe(value: ResolvedPlace, person: PersonRow | null): ResolvedPlace {
  if (person?.role !== "child" || value.lat === null || value.lon === null) return value;
  const area = childSafeAreaLabel(value.area);
  return { ...value, area, lat: Number(value.lat.toFixed(1)), lon: Number(value.lon.toFixed(1)), precision: "area", label: area };
}

async function geocode(name: string): Promise<{ lat: number; lon: number; area: string | null } | null> {
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("count", "1");
    url.searchParams.set("name", name);
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const body = await response.json() as { results?: Array<{ latitude?: number; longitude?: number; name?: string; admin1?: string; country?: string }> };
    const result = body.results?.[0];
    if (typeof result?.latitude !== "number" || typeof result.longitude !== "number") return null;
    return { lat: result.latitude, lon: result.longitude, area: [result.name, result.admin1, result.country].filter(Boolean).join(", ").slice(0, 200) || null };
  } catch {
    return null;
  }
}

function entityResult(entity: EntityT, from: ResolvedPlace["from"]): ResolvedPlace {
  return { label: entity.name, area: entity.geo?.area ?? null, lat: entity.geo?.lat ?? null, lon: entity.geo?.lon ?? null, precision: entity.geo?.precision ?? null, from };
}

async function withGeocode(place: ResolvedPlace, name: string): Promise<ResolvedPlace> {
  if (place.lat !== null && place.lon !== null) return place;
  const found = await geocode(name);
  return found ? { ...place, area: found.area, lat: found.lat, lon: found.lon, precision: "exact" } : place;
}

/** Resolves a place without persisting request data. `current` is consumed
 * only in this call and is never passed to a storage or turn writer. */
export async function resolvePlace(input: {
  person: PersonRow | null;
  surface: PlaceSurface;
  named?: string | null;
  current?: CurrentCoordinates | null;
}): Promise<ResolvedPlace> {
  const { person, surface } = input;
  const visible = person ? listEntities(person, "place") : db.select().from(entities).where(and(eq(entities.kind, "place"), eq(entities.scope, "household"), isNull(entities.deletedAt))).all().map((row) => {
    const parsed = JSON.parse(row.geo ?? "null") as EntityT["geo"];
    return { id: row.id, kind: "place", name: row.name, aliases: JSON.parse(row.aliases) as string[], description: row.description, place_kind: row.placeKind, geo: parsed, parent_id: row.parentId, account_person_id: row.accountPersonId, source: row.source, confirmed_by_person_id: row.confirmedByPersonId, confirmed_at: row.confirmedAt, scope: row.scope, person: row.person, sensitive: row.sensitive, pronouns: row.pronouns, created_at: row.createdAt, updated_at: row.updatedAt, deleted_at: row.deletedAt, hlc: row.hlc } as EntityT;
  });

  const named = input.named?.trim();
  if (named) {
    const matched = visible.find((place) => place.kind === "place" && [place.name, ...place.aliases].some((part) => part.localeCompare(named, undefined, { sensitivity: "accent" }) === 0));
    if (matched) return childSafe(await withGeocode(entityResult(matched, "named"), matched.name), person);
    const found = await geocode(named);
    return childSafe(found ? { label: named, area: found.area, lat: found.lat, lon: found.lon, precision: "exact", from: "named" } : { ...emptyPlace(), label: named, from: "named" }, person);
  }

  if (person) {
    const configured = getPersonSettingValue(person, `${surface}.default_place`);
    const defaultPlace = configured ?? "current";
    if (defaultPlace === "current" && input.current) {
      const current: ResolvedPlace = { label: input.current.area ?? "Current location", area: input.current.area ?? null, lat: input.current.lat, lon: input.current.lon, precision: "exact", from: "current" };
      return childSafe(current, person);
    }
    if (typeof defaultPlace === "string" && defaultPlace !== "current") {
      const result = getEntity(person, defaultPlace);
      if (result.ok && result.value) return childSafe(await withGeocode(entityResult(result.value, "saved"), result.value.name), person);
    }
  }

  const homeId = getHouseholdSettingValue("household.home");
  if (typeof homeId === "string") {
    const row = db.select().from(entities).where(and(eq(entities.id, homeId), isNull(entities.deletedAt))).get();
    if (row && row.kind === "place" && row.scope === "household") {
      const home = getEntity(person ?? { id: "system", role: "adult" } as PersonRow, homeId);
      if (home.ok && home.value) return childSafe(await withGeocode(entityResult(home.value, "household"), home.value.name), person);
    }
  }
  return emptyPlace();
}

/** Calls the existing Open-Meteo geocoder used by the bundled weather
 * package. Failure is an empty candidate list and never logs the query. */
export async function searchPlaces(query: string, person: PersonRow): Promise<Array<{ name: string; area: string | null; lat: number; lon: number }>> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const found = await geocodeMany(trimmed);
  return found.map((candidate) => person.role === "child"
    ? { ...candidate, area: childSafeAreaLabel(candidate.area), lat: Number(candidate.lat.toFixed(1)), lon: Number(candidate.lon.toFixed(1)) }
    : candidate);
}

async function geocodeMany(name: string): Promise<Array<{ name: string; area: string | null; lat: number; lon: number }>> {
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("count", "5");
    url.searchParams.set("name", name);
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return [];
    const body = await response.json() as { results?: Array<{ latitude?: number; longitude?: number; name?: string; admin1?: string; country?: string }> };
    return (body.results ?? []).filter((row) => typeof row.latitude === "number" && typeof row.longitude === "number" && typeof row.name === "string")
      .map((row) => ({ name: row.name!, area: [row.admin1, row.country].filter(Boolean).join(", ").slice(0, 200) || null, lat: row.latitude!, lon: row.longitude! }));
  } catch {
    return [];
  }
}
