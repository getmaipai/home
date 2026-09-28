import type { UpdateProjection } from "@/lib/api";

export interface UpdateRow {
  kind: "app" | "engine" | "model" | "reference";
  id: string;
  name: string;
  installed: string | null;
  available: string | null;
  lastChecked: string | null;
  notes: string | null;
}

export function rowsFrom(projection: UpdateProjection): UpdateRow[] {
  const rows: UpdateRow[] = [
    { kind: "app", id: "app", name: "MaiPai Home", installed: projection.installed, available: projection.latest, lastChecked: projection.checkedAt, notes: projection.error ?? projection.summary },
  ];
  if (projection.stack) {
    for (const engine of projection.stack.engines) {
      rows.push({ kind: "engine", id: `engine:${engine.name}`, name: engine.name, installed: engine.installed, available: engine.availableKnown ? engine.available : null, lastChecked: engine.lastChecked, notes: engine.notes });
    }
    for (const model of projection.stack.models.entries) {
      rows.push({ kind: "model", id: `model:${model.id}`, name: model.id, installed: model.installed, available: model.available, lastChecked: projection.stack.models.lastChecked, notes: null });
    }
  }
  if (projection.reference) {
    for (const reference of projection.reference.entries) {
      rows.push({ kind: "reference", id: `reference:${reference.id}`, name: reference.name, installed: reference.installed, available: reference.available, lastChecked: reference.lastChecked, notes: reference.notes });
    }
  }
  return rows;
}

export function hasUpdate(row: UpdateRow): boolean {
  return row.available !== null && row.available !== row.installed;
}
