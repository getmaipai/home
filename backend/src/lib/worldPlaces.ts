import { and, eq, isNull } from "drizzle-orm";
import { WorldPlace } from "@maipai/spec/gen/ts/world-place.js";
import type { WorldPlace as WorldPlaceT } from "@maipai/spec/gen/ts/world-place.js";
import { db } from "@/db";
import { worldPlaces } from "@/db/schema";
import { randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";

type Result<T> = { ok: true; value: T } | { ok: false; status: 400 | 404; error: string };
type Row = typeof worldPlaces.$inferSelect;

function shape(row: Row): WorldPlaceT {
  return WorldPlace.parse({
    id: row.id,
    person: row.person,
    name: row.name,
    country: row.country,
    zone: row.zone,
    position: row.position,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
    hlc: row.hlc,
  });
}

function own(actor: PersonRow, id: string) {
  return db
    .select()
    .from(worldPlaces)
    .where(and(eq(worldPlaces.id, id), eq(worldPlaces.person, actor.id), isNull(worldPlaces.deletedAt)))
    .get();
}

export function listWorldPlaces(actor: PersonRow) {
  return db
    .select()
    .from(worldPlaces)
    .where(and(eq(worldPlaces.person, actor.id), isNull(worldPlaces.deletedAt)))
    .all()
    .map(shape)
    .sort((a, b) => a.position - b.position);
}

export function createWorldPlace(
  actor: PersonRow,
  input: { name?: string; country?: string; zone?: string; position?: number; source?: "hub" | "local" },
): Result<WorldPlaceT> {
  if (listWorldPlaces(actor).length >= 12) {
    return { ok: false, status: 400, error: "You can save up to 12 places." };
  }

  const name = input.name?.trim() ?? "";
  const country = input.country?.trim() ?? "";
  const zone = input.zone ?? "";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    return { ok: false, status: 400, error: "Choose a valid time zone." };
  }

  const now = new Date().toISOString();
  const candidate = WorldPlace.safeParse({
    id: `place-${randomSuffix(10)}`,
    person: actor.id,
    name,
    country,
    zone,
    position: input.position ?? listWorldPlaces(actor).length,
    source: input.source ?? "hub",
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hlc: nextHlc(),
  });

  if (!candidate.success) return { ok: false, status: 400, error: "Invalid world place." };

  db.insert(worldPlaces)
    .values({
      id: candidate.data.id,
      person: candidate.data.person,
      name: candidate.data.name,
      country: candidate.data.country,
      zone: candidate.data.zone,
      position: candidate.data.position,
      source: candidate.data.source,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      hlc: candidate.data.hlc,
    })
    .run();

  return { ok: true, value: candidate.data };
}

export function updateWorldPlace(
  actor: PersonRow,
  id: string,
  edit: Partial<Pick<WorldPlaceT, "name" | "country" | "zone" | "position">>,
): Result<WorldPlaceT> {
  const row = own(actor, id);
  if (!row) return { ok: false, status: 404, error: "No such place." };

  const current = shape(row);
  const zone = edit.zone ?? current.zone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    return { ok: false, status: 400, error: "Choose a valid time zone." };
  }

  const now = new Date().toISOString();
  const candidate = WorldPlace.safeParse({
    ...current,
    ...edit,
    name: edit.name?.trim() ?? current.name,
    country: edit.country?.trim() ?? current.country,
    updated_at: now,
    hlc: nextHlc(),
  });

  if (!candidate.success) return { ok: false, status: 400, error: "Invalid world place." };

  db.update(worldPlaces)
    .set({
      name: candidate.data.name,
      country: candidate.data.country,
      zone: candidate.data.zone,
      position: candidate.data.position,
      updatedAt: now,
      hlc: candidate.data.hlc,
    })
    .where(eq(worldPlaces.id, id))
    .run();

  return { ok: true, value: candidate.data };
}

export function deleteWorldPlace(actor: PersonRow, id: string): Result<{ id: string }> {
  if (!own(actor, id)) return { ok: false, status: 404, error: "No such place." };

  const now = new Date().toISOString();
  db.update(worldPlaces)
    .set({ deletedAt: now, updatedAt: now, hlc: nextHlc() })
    .where(eq(worldPlaces.id, id))
    .run();

  return { ok: true, value: { id } };
}
