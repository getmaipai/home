// The chat program's generated-document experience (artifact-card,
// canvas-split): a versioned markdown/code/html document the model
// creates and edits, distinct from TurnArtifact/composer.ts's evidence-
// grounded details document. spec/schemas/artifact.schema.json is one
// immutable version per row, chained by parent_version; this file owns
// the version-chain bookkeeping (artifactKey, the current pointer) that
// lives only in Home's own table, never in the synced spec shape.
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, conversationTurns } from "@/db/schema";
import { Artifact, type Artifact as ArtifactValue } from "@maipai/spec/gen/ts/artifact.js";
import { newArtifactId, newArtifactKey } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { canAccessPerson } from "@/lib/access";
import type { OpResult } from "@/lib/entities";
import type { PersonRow } from "@/types";

export type ArtifactRow = typeof artifacts.$inferSelect;

export function toArtifact(row: ArtifactRow): ArtifactValue {
  return Artifact.parse({
    id: row.id,
    conversation_id: row.conversationId,
    turn_id: row.turnId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    version: row.version,
    parent_version: row.parentVersion,
    created_by: row.createdBy,
    provenance: row.provenance,
    created_at: row.createdAt,
    hlc: row.hlc,
  });
}

export interface CreateArtifactInput {
  conversationId: string;
  turnId: string;
  kind: ArtifactValue["kind"];
  title: string;
  body: string;
  createdBy: string;
  provenance: string;
  now?: Date;
}

/** The first version of a new artifact. Mints a fresh artifactKey (Home-
 * internal, groups every later version of this same artifact) alongside
 * the spec record's own id. */
export function createArtifact(input: CreateArtifactInput): ArtifactValue {
  const now = (input.now ?? new Date()).toISOString();
  const row: ArtifactRow = {
    id: newArtifactId(),
    artifactKey: newArtifactKey(),
    conversationId: input.conversationId,
    turnId: input.turnId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    version: 1,
    parentVersion: null,
    createdBy: input.createdBy,
    provenance: input.provenance,
    createdAt: now,
    hlc: nextHlc(),
    isCurrent: true,
  };
  const value = toArtifact(row);
  db.insert(artifacts).values(row).run();
  return value;
}

export interface UpdateArtifactInput {
  /** The id of the version being edited. Must be the artifact's current
   * version - editing a historical version is not a supported move
   * (there is nothing to "redo forward" to; start a new artifact
   * instead, or extend this once branching from history is asked for). */
  currentId: string;
  title?: string;
  body: string;
  turnId: string;
  createdBy: string;
  provenance: string;
  now?: Date;
}

/** A new version chained onto the current one. Flips the old row's
 * isCurrent off and inserts the new row as current in one transaction, so
 * a reader never sees two current versions, or none, mid-write. */
export function updateArtifact(input: UpdateArtifactInput): OpResult<ArtifactValue> {
  return db.transaction((tx) => {
    const current = tx.select().from(artifacts).where(eq(artifacts.id, input.currentId)).get();
    if (!current) return { ok: false, status: 404, error: "no such artifact version" };
    if (!current.isCurrent) return { ok: false, status: 409, error: "not the current version - it was already superseded" };
    const now = (input.now ?? new Date()).toISOString();
    const row: ArtifactRow = {
      id: newArtifactId(),
      artifactKey: current.artifactKey,
      conversationId: current.conversationId,
      turnId: input.turnId,
      kind: current.kind as ArtifactValue["kind"],
      title: input.title ?? current.title,
      body: input.body,
      version: current.version + 1,
      parentVersion: current.id,
      createdBy: input.createdBy,
      provenance: input.provenance,
      createdAt: now,
      hlc: nextHlc(),
      isCurrent: true,
    };
    tx.update(artifacts).set({ isCurrent: false }).where(eq(artifacts.id, current.id)).run();
    tx.insert(artifacts).values(row).run();
    return { ok: true, status: 201, value: toArtifact(row) };
  });
}

export function getArtifactRow(id: string): ArtifactRow | null {
  return db.select().from(artifacts).where(eq(artifacts.id, id)).get() ?? null;
}

export function currentArtifactRow(artifactKey: string): ArtifactRow | null {
  return db.select().from(artifacts).where(and(eq(artifacts.artifactKey, artifactKey), eq(artifacts.isCurrent, true))).get() ?? null;
}

/** A child sees an artifact only from a turn that is theirs and that
 * passed safety - the same "own turns only" rule canAccessPerson already
 * enforces for an adult's own turns, plus the safety gate an artifact
 * needs of its own (a refused turn produces no artifact today, but this
 * is the access check, not a bet on what the composer currently does). */
export function visibleArtifactRow(actor: PersonRow, row: ArtifactRow): boolean {
  const turn = db.select().from(conversationTurns).where(eq(conversationTurns.id, row.turnId)).get();
  if (!turn || !canAccessPerson(actor, turn.personId)) return false;
  if (actor.role === "child" && turn.safetyAction === "refuse") return false;
  return true;
}
