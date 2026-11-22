// CODE-AGENT-01 (first slice) and CODE-TIER-03: the Code session store and its lifecycle (create, list, get, stop, delete). A session record is the
// spec `coding-session`. Its `tier` is the person's stored wish: it survives a restart, and every turn clamps it again and writes the corrected value
// back (`correctStoredTier`). `model_id` is provenance written from the agent's reply, never a choice, and Home never maps a tier to a model (rule E).
// Turns, the queue, the Max lease and the agent live in lib/codingTurns.ts. Rule 6a: nothing here puts a title, repository or path in a log or a job.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { CodingSession } from "@maipai/spec/gen/ts/coding-session.js";
import { db } from "@/db";
import { codingSessions, people } from "@/db/schema";
import { newCodingSessionId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { codeAdmission } from "@/lib/apiKeys";
import { listGitConnections } from "@/lib/gitConnections";
import { authorizeTier, isTier, type Tier, type TierChoice } from "@/lib/tiers";
import { missingCodingPiece } from "@/lib/stackCodingPieces";
import { appendLogLine } from "@/lib/log";
import type { PersonRow } from "@/types";

type Row = typeof codingSessions.$inferSelect;
export type CodingSessionWire = z.infer<typeof CodingSession>;
export type CodingSessionState = Row["state"];

/** How long a deleted session stays recoverable (a guess, see the slice notes: the design names a trash window but no length). */
export const TRASH_DAYS = 30;

export class CodingSessionError extends Error {
  constructor(readonly code: "not_allowed" | "not_found" | "bad_input" | "busy", message: string) { super(message); }
}

export const CreateCodingSessionInput = z.object({
  title: z.string().trim().min(1).max(120),
  repo: CodingSession.shape.repo,
  environment_id: z.string().regex(/^cenv-[a-z0-9]{6,}$/),
  mode: z.enum(["plan", "ask", "auto_edit"]).default("ask"),
  /** Absent means the tier the person used last in Code (design 3.2), clamped to what they may run now. */
  tier: z.enum(["standard", "boost", "max"]).optional(),
  network: CodingSession.shape.network.default({ policy: "none", hosts: [] }),
  mounts: CodingSession.shape.mounts,
}).strict();

/** Why this person may not use Code sessions now, or null. Follows the Coding switch and `use:code`, like git connections; the personal API-key toggle does not apply to the app. */
export function codingSessionRefusal(person: PersonRow): string | null {
  const admission = codeAdmission(person);
  if (admission === "not_allowed") return "Coding is not allowed for you. Ask an admin to check your Coding access in Settings.";
  if (admission === "coding_off") return "Coding is turned off for this household. Ask an admin to turn it on in Settings, Coding.";
  if (admission === "coding_paused") return "Coding is paused for this household. Try again when an admin resumes it.";
  if (admission === "piece_missing") return missingCodingPiece() ?? "A Coding piece is not installed yet. Ask an admin to finish the Coding setup in Settings.";
  return null;
}

/** Throws the household's admission copy when this person may not use Code now (a revoked grant, a guest, an ungranted minor, Coding off). Stop and delete skip it so a running turn can always be ended. */
export function requireCodingAccess(person: PersonRow): void {
  const refusal = codingSessionRefusal(person);
  if (refusal) throw new CodingSessionError("not_allowed", refusal);
}

function wire(row: Row): CodingSessionWire {
  return CodingSession.parse({
    id: row.id, person_id: row.personId, title: row.title, repo: row.repo, environment_id: row.environmentId, mode: row.mode, state: row.state, tier: row.tier,
    network: row.network, ...(row.mounts ? { mounts: row.mounts } : {}), ...(row.modelId ? { model_id: row.modelId } : {}), usage: row.usage, changes: row.changes,
    created_at: row.createdAt, last_activity_at: row.lastActivityAt, ...(row.deletedAt ? { deleted_at: row.deletedAt, trash_until: row.trashUntil } : {}),
    provenance: row.provenance, hlc: row.hlc,
  });
}

/** What an admin sees (rule 6a): ids, state and tier only. No title, repository or path. */
export interface CodingSessionAdminWire { id: string; person_id: string; state: CodingSessionState; tier: Tier; created_at: string; last_activity_at: string }

export function getSessionRow(personId: string, id: string): Row | null {
  return db.select().from(codingSessions).where(and(eq(codingSessions.id, id), eq(codingSessions.personId, personId), isNull(codingSessions.deletedAt))).get() ?? null;
}
const ownerOf = (personId: string): PersonRow | undefined => db.select().from(people).where(eq(people.id, personId)).get() as PersonRow | undefined;

/** The tier a new session starts on: the one the person's latest session holds, else Standard (a stored preference of its own is not needed: the record is the memory). */
function lastTierOf(personId: string): Tier {
  const last = db.select({ tier: codingSessions.tier }).from(codingSessions).where(eq(codingSessions.personId, personId)).orderBy(desc(codingSessions.createdAt)).limit(1).get();
  return last && isTier(last.tier) ? last.tier : "standard";
}

export function createCodingSession(person: PersonRow, input: z.input<typeof CreateCodingSessionInput>): CodingSessionWire {
  const refusal = codingSessionRefusal(person);
  if (refusal) throw new CodingSessionError("not_allowed", refusal);
  const parsed = CreateCodingSessionInput.safeParse(input);
  if (!parsed.success) throw new CodingSessionError("bad_input", "The session details are invalid. Give it a title, a repository choice and an environment, then try again.");
  const body = parsed.data;
  if (body.repo.kind === "github" || body.repo.kind === "gitea") {
    // The connection must be the person's own and still working; the token itself is never read here (lib/gitConnections.ts keeps that one reader).
    const connection = listGitConnections(person).find((c) => c.id === body.repo.connection_id);
    if (!connection || connection.status !== "active" || connection.kind !== body.repo.kind) {
      throw new CodingSessionError("bad_input", "That git connection is not available. Reconnect it in Settings, Coding, then start the session again.");
    }
  }
  const tier = authorizeTier({ person, category: "coding", requested: body.tier ?? lastTierOf(person.id) }).tier;
  const at = new Date().toISOString();
  const row = db.insert(codingSessions).values({
    id: newCodingSessionId(), personId: person.id, title: body.title, repo: body.repo, environmentId: body.environment_id, mode: body.mode, state: "idle", tier,
    network: body.network, mounts: body.mounts ?? null, usage: { input_tokens: 0, output_tokens: 0 }, changes: { files: 0, additions: 0, deletions: 0 },
    createdAt: at, lastActivityAt: at, provenance: "Started in the Code app", hlc: nextHlc(), updatedAt: at,
  }).returning().get();
  appendLogLine(`coding session_created session=${row.id} person=${person.id} tier=${tier}`);
  return wire(row);
}

export function listCodingSessions(person: Pick<PersonRow, "id">): CodingSessionWire[] {
  return db.select().from(codingSessions).where(and(eq(codingSessions.personId, person.id), isNull(codingSessions.deletedAt))).orderBy(desc(codingSessions.lastActivityAt)).all().map(wire);
}
export function listCodingSessionsForAdmin(): CodingSessionAdminWire[] {
  return db.select().from(codingSessions).where(isNull(codingSessions.deletedAt)).all()
    .map((r) => ({ id: r.id, person_id: r.personId, state: r.state, tier: r.tier, created_at: r.createdAt, last_activity_at: r.lastActivityAt }));
}
export function getCodingSession(person: Pick<PersonRow, "id">, id: string): CodingSessionWire | null {
  const row = getSessionRow(person.id, id);
  return row ? wire(row) : null;
}

/** The one writer of a session's state and counters; every change stamps the clock. */
export function updateSession(id: string, patch: Partial<Pick<Row, "state" | "tier" | "modelId" | "usage" | "lastActivityAt">>): void {
  const at = new Date().toISOString();
  db.update(codingSessions).set({ ...patch, updatedAt: at, hlc: nextHlc() }).where(eq(codingSessions.id, id)).run();
}

/** The person switches the stored tier now; it applies at the next turn (design 3.2). A tier the person may not run is refused, never lowered silently. */
export function setSessionTier(person: PersonRow, id: string, requested: Tier): CodingSessionWire {
  requireCodingAccess(person);
  const row = getSessionRow(person.id, id);
  if (!row) throw new CodingSessionError("not_found", "That session was not found. It may have been deleted.");
  const choice = authorizeTier({ person, category: "coding", requested });
  if (choice.tier !== requested) throw new CodingSessionError("not_allowed", "You cannot use that level for coding. Pick another level.");
  updateSession(id, { tier: requested });
  return wire(getSessionRow(person.id, id)!);
}

/** Each turn runs `clampTier` again (design 3.2): the stored tier is a wish, the turn's tier is the truth. A lowered value is written back at once. */
export function correctStoredTier(row: Pick<Row, "id" | "personId" | "tier">): TierChoice {
  const person = ownerOf(row.personId);
  if (!person) return { tier: "standard", note: "not_for_this_person" };
  const choice = authorizeTier({ person, category: "coding", requested: row.tier });
  if (choice.tier !== row.tier) {
    updateSession(row.id, { tier: choice.tier });
    appendLogLine(`coding tier_corrected session=${row.id} from=${row.tier} to=${choice.tier} reason=${choice.note ?? "none"}`);
  }
  return choice;
}

/** Soft delete: the record leaves the list and stays recoverable for TRASH_DAYS. The caller (lib/codingTurns.ts) stops a running turn and the sandbox first. */
export function markSessionDeleted(person: Pick<PersonRow, "id">, id: string): boolean {
  if (!getSessionRow(person.id, id)) return false;
  const now = new Date();
  const at = now.toISOString();
  db.update(codingSessions).set({ deletedAt: at, trashUntil: new Date(now.getTime() + TRASH_DAYS * 86_400_000).toISOString(), state: "archived", updatedAt: at, hlc: nextHlc() })
    .where(eq(codingSessions.id, id)).run();
  appendLogLine(`coding session_deleted session=${id} person=${person.id}`);
  return true;
}

/** Startup: a turn does not survive a restart (its transcript store is a later slice), so a session that was queued or working reads as idle again. The stored tier stays. */
export function settleSessionsAtStartup(): number {
  const at = new Date().toISOString();
  return db.update(codingSessions).set({ state: "idle", updatedAt: at, hlc: nextHlc() }).where(inArray(codingSessions.state, ["queued", "starting", "working"])).returning({ id: codingSessions.id }).all().length;
}
