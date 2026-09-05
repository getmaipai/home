// The `command` primitive (platform plan, "Naming: skill, plugin,
// command, connector" - docs/dev.md, 2026-09-05): "when I say X, do Y,"
// authored by a household at runtime through a real settings flow, not a
// filesystem package a developer ships. The routing MECHANISM is not
// new - a command's trigger is matched exactly (case-insensitive,
// trimmed, no wildcard) via turnEngine.ts's own matchPattern, the exact
// same function a plugin's own zero-wildcard `routing.patterns` entry
// already uses. What's new is a lighter-weight AUTHORING path: no
// manifest.json, no recipe.json, no five-example bronze-tier bar - a
// trigger phrase and one of two fixed action shapes.
//
// Not a spec 3.1 record type, the same call lib/scheduler.ts's
// scheduledJobs already made for the identical reason: this is real,
// substantial, household-facing functionality that doesn't need to sync
// to the robot in this slice. Promote it to spec/ the moment that
// changes, not before.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { commands } from "@/db/schema";
import { newCommandId } from "@/lib/id";
import { meetsMinRole } from "@/lib/plugins";
import { isOwnerOrAdmin } from "@/lib/access";
import { homeCallService, isHomeAssistantSecurityDomain } from "@/lib/packageHost";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { matchPattern } from "@/lib/turnEngine";
import { ROLE_LADDER, type Role } from "@/middleware/auth";
import type { PersonRow } from "@/types";

export type CommandOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; error: string };

const ReplyAction = z.object({
  kind: z.literal("reply"),
  text: z.string().min(1).max(500),
  speech: z.string().min(1).max(500).optional(),
});

const HomeCallServiceAction = z.object({
  kind: z.literal("home_call_service"),
  domain: z.string().min(1),
  service: z.string().min(1),
  target: z.record(z.string(), z.unknown()).default({}),
  data: z.record(z.string(), z.unknown()).optional(),
});

const CommandAction = z.discriminatedUnion("kind", [ReplyAction, HomeCallServiceAction]);
export type CommandAction = z.infer<typeof CommandAction>;

export interface CommandRow {
  id: string;
  creatorId: string;
  trigger: string;
  minRole: string;
  action: CommandAction;
  createdAt: string;
}

function toCommandRow(row: typeof commands.$inferSelect): CommandRow {
  return {
    id: row.id,
    creatorId: row.creatorId,
    trigger: row.trigger,
    minRole: row.minRole,
    action: JSON.parse(row.actionData) as CommandAction,
    createdAt: row.createdAt,
  };
}

// The floor for CREATING any command at all - a real capability
// ("when I say X, do Y" can reach Home Assistant), not something a
// child or an unauthenticated guest profile should set up unsupervised.
// Separate from - and independent of - `minRole`, which only gates who
// can later TRIGGER an already-created command by speaking its phrase.
const MIN_ROLE_TO_CREATE: Role = "adult";

/** Same "raises the bar" posture packageHost.ts's own home.call_service
 * already applies to a plugin's `consequential` flag, adapted to a
 * command's own creation-time authorization: a security domain (lock,
 * alarm, cover, garage door, valve) is real physical access, so a
 * command that can touch one needs BOTH a more trusted creator (owner or
 * admin, not just any adult) AND a floor no looser than `adult` for
 * whoever can later trigger it - a household member setting this up
 * cannot accidentally leave a door-unlock command a child's voice could
 * fire. Checked at creation time, once, rather than re-derived on every
 * trigger: simpler, and the household member setting an unusual minRole
 * for a security command gets told why immediately, not silently
 * overridden. */
function validateSecurityDomainFloor(action: CommandAction, minRole: string, creator: PersonRow): string | null {
  if (action.kind !== "home_call_service") return null;
  if (!isHomeAssistantSecurityDomain(action.domain)) return null;
  if (!isOwnerOrAdmin(creator)) {
    return `a command touching the security domain "${action.domain}" can only be created by an owner or admin`;
  }
  const requiredIdx = ROLE_LADDER.indexOf("adult");
  const requestedIdx = ROLE_LADDER.indexOf(minRole as Role);
  if (requestedIdx === -1 || requestedIdx > requiredIdx) {
    return `a command touching the security domain "${action.domain}" needs a min_role of "adult" or higher`;
  }
  return null;
}

/** Case-insensitive, trimmed equality - the same notion of "the same
 * trigger" matchPattern's own zero-wildcard exact-match branch already
 * uses, so a duplicate can never exist that would only be distinguishable
 * by which one happens to load first. */
function sameTrigger(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function createCommand(
  creator: PersonRow,
  trigger: string,
  minRole: string,
  actionInput: unknown,
): CommandOpResult<CommandRow> {
  if (!meetsMinRole(creator.role, MIN_ROLE_TO_CREATE)) {
    return { ok: false, status: 403, error: `creating a command needs role ${MIN_ROLE_TO_CREATE} or higher` };
  }
  if (typeof trigger !== "string" || trigger.trim().length === 0) {
    return { ok: false, status: 400, error: "trigger is required" };
  }
  // matchCommand() reuses turnEngine.ts's own matchPattern() as-is (this
  // file's own header comment: "the routing MECHANISM is not new"), and
  // that function treats a bare `*` as a wildcard-capture pattern, not a
  // literal character - a code review (2026-09-05) found nothing here
  // stopped a trigger containing one from silently becoming fuzzier than
  // "exact match only, never a guess" (the invariant this file, and
  // docs/dev.md's own writeup of it, both state). Rejected outright
  // rather than escaped: a household member typing "unlock * door" meant
  // an exact phrase, not a pattern language they were never offered.
  if (trigger.includes("*")) {
    return { ok: false, status: 400, error: "trigger cannot contain \"*\" - a command trigger is always matched exactly" };
  }
  if (!ROLE_LADDER.includes(minRole as Role)) {
    return { ok: false, status: 400, error: `unrecognized min_role: ${minRole}` };
  }
  const parsedAction = CommandAction.safeParse(actionInput);
  if (!parsedAction.success) {
    return { ok: false, status: 400, error: `action failed validation: ${parsedAction.error.message}` };
  }
  const securityError = validateSecurityDomainFloor(parsedAction.data, minRole, creator);
  if (securityError) return { ok: false, status: 403, error: securityError };

  const existing = db.select().from(commands).all();
  if (existing.some((c) => sameTrigger(c.trigger, trigger))) {
    return { ok: false, status: 400, error: `a command for "${trigger.trim()}" already exists` };
  }

  const row = {
    id: newCommandId(),
    creatorId: creator.id,
    trigger: trigger.trim(),
    minRole,
    actionKind: parsedAction.data.kind,
    actionData: JSON.stringify(parsedAction.data),
    createdAt: new Date().toISOString(),
  };
  db.insert(commands).values(row).run();
  return { ok: true, value: toCommandRow(row) };
}

/** Household-wide, like scheduledJobs' own listJobs() precedent for a
 * shared, non-personal record: a command's trigger and action are
 * something every household member benefits from seeing exists, not
 * private state scoped to whoever created it. */
export function listCommands(): CommandRow[] {
  return db.select().from(commands).all().map(toCommandRow);
}

/** The creator, or an owner/admin cleaning up after someone else - never
 * an unrelated non-admin household member, the same shape scheduledJobs'
 * own cancelJob() authorization already takes. */
export function deleteCommand(actor: PersonRow, id: string): CommandOpResult<{ id: string }> {
  const existing = db.select().from(commands).where(eq(commands.id, id)).get();
  if (!existing) return { ok: false, status: 404, error: `no command ${id}` };
  if (existing.creatorId !== actor.id && !isOwnerOrAdmin(actor)) {
    return { ok: false, status: 403, error: "only the creator or an owner/admin can delete this command" };
  }
  db.delete(commands).where(eq(commands.id, id)).run();
  return { ok: true, value: { id } };
}

/** The deterministic command floor (checked before the plugin floor in
 * turnEngine.ts's prepareTurn(), same "a real trigger always wins"
 * posture route()'s own pattern match already has - a command IS
 * exactly that, just household-authored instead of bundled). Exact
 * match only, gated by whether the speaker's own role clears this
 * command's floor; the first match wins on ties, an acceptable
 * simplicity given trigger uniqueness is already enforced at creation. */
export function matchCommand(text: string, actor: PersonRow): CommandRow | null {
  for (const row of db.select().from(commands).all()) {
    if (!meetsMinRole(actor.role, row.minRole)) continue;
    if (matchPattern(text, row.trigger) === null) continue;
    return toCommandRow(row);
  }
  return null;
}

/** Runs a matched command's action, mapping a raised HostError (only
 * possible for a home_call_service action - Home Assistant not set up,
 * rate-limited, unreachable) to the same result shape every other write
 * in this codebase returns, the same posture lib/plugins.ts's runPlugin()
 * already takes for its own HostError mapping. */
export async function runCommand(command: CommandRow): Promise<CommandOpResult<{ text: string; speech?: string }>> {
  try {
    if (command.action.kind === "reply") {
      return { ok: true, value: { text: command.action.text, speech: command.action.speech } };
    }
    const { domain, service, target, data } = command.action;
    // Real Home Assistant domains are canonically lowercase - packageHost.ts's
    // own createHost() call_service already lowercases before using the
    // domain anywhere for exactly this reason. A code review (2026-09-05)
    // found this path never did: validateSecurityDomainFloor's own
    // isHomeAssistantSecurityDomain() lowercases internally, so a
    // mixed-case domain like "Lock" still passed creation-time gating
    // correctly, but would have hit the real HA API as literal
    // "/api/services/Lock/unlock" and failed every time the command ran.
    await homeCallService(domain.toLowerCase(), service, target, data ?? null);
    return { ok: true, value: { text: "Done." } };
  } catch (err) {
    if (err instanceof HostError) {
      const status = err.code === "permission_denied" ? 403 : err.code === "not_found" ? 404 : 400;
      return { ok: false, status, error: err.message };
    }
    throw err;
  }
}
