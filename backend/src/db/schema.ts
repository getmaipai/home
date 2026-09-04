import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

// Mirrors spec/schemas/person.schema.json (spec/gen/ts/person.ts is the
// validated shape; this is its storage). `role` and `source` are the
// schema's enums; sqlite has no enum type so they're stored as text and
// validated by the Zod schema before a write ever reaches here.
export const people = sqliteTable("people", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  nickname: text("nickname"),
  birthdate: text("birthdate"),
  role: text("role").notNull(),
  avatarSeed: text("avatar_seed").notNull(),
  source: text("source").notNull(),
  localOnly: integer("local_only", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

// A person's sign-in secret (PIN or password, same hashing either way, see
// lib/secret.ts). Separate from `people` so the profile picker's public
// listing query never has to project a hash column out by hand. Not every
// person has one: 4.1 says a PIN-free profile is allowed for a non-admin
// role (the household picker), so this is 0-or-1 rows per person, not
// 1-to-1.
export const personCredentials = sqliteTable("person_credentials", {
  personId: text("person_id")
    .primaryKey()
    .references(() => people.id),
  secretHash: text("secret_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

// Backs the spec's {prefix}{seq}-{device6} id shape (3.1) for
// memory/entity/episode records: one monotonic counter per record_kind.
// See lib/id.ts.
export const idSequences = sqliteTable("id_sequences", {
  kind: text("kind").primaryKey(),
  next: integer("next").notNull(),
});

// Mirrors spec/schemas/memory-record.schema.json (4.4): one table for all
// three record_kinds (memory, entity, episode), matching the spec's "one
// row, one field set" shape. Never hard-deleted by the routine store
// operations (supersede/archive); a real DELETE only happens through
// lib/memory.ts's forget(), the deliberate per-person erasure right
// (2.2's privacy architecture, distinct from the judge's normal
// never-hard-delete lifecycle).
export const memoryRecords = sqliteTable("memory_records", {
  id: text("id").primaryKey(),
  recordKind: text("record_kind").notNull(),
  text: text("text").notNull(),
  category: text("category").notNull(),
  tier: text("tier").notNull(),
  status: text("status").notNull(),
  scope: text("scope").notNull(),
  person: text("person").references(() => people.id),
  source: text("source").notNull(),
  importance: real("importance").notNull(),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
  uses: integer("uses").notNull().default(0),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at").notNull(),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  expiredAt: text("expired_at"),
  supersededBy: text("superseded_by"),
  embeddingSpace: text("embedding_space"),
});

// Mirrors spec/schemas/setting-value.schema.json (4.6): one row per
// (scope, key), scope holding the full spec string ("household",
// "person:<id>", or "device:<id>") rather than a separate kind+id pair,
// so this table matches the spec shape exactly with no denormalization.
// `value` is JSON-serialized (its real shape depends on the key's
// selector in the registry, spec/settings/keys.json, validated at the
// lib/settings.ts layer, not by SQLite). Deleting a row (a settings
// "reset") is always a genuine erasure, not a tombstone: unlike memory,
// nothing here promises "never hard-deletes" and a reset-to-default has
// no reason to keep history.
export const settingsValues = sqliteTable(
  "settings_values",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    hlc: text("hlc").notNull(),
    source: text("source").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.key] })],
);

// The durable scheduler port (4.7): "one-shot and recurring jobs...
// persisted, survives restarts." Not a spec 3.1 record type (chapter 3's
// own record table has no Job entry, and 4.7 doesn't ask for one), so
// this is hub-internal storage, not a spec/schemas/*.schema.json shape,
// the same way `sessions` and `id_sequences` are internal. See
// lib/scheduler.ts for why, and what's deferred (device targets,
// quiet-hours, the notification system) until this needs to be a spec
// shape for real robot parity.
// Conversation history (4.14, split): one row per completed turnEngine
// turn, kept per person and per surface. Not a spec 3.1 record type
// today (chapter 3's record table has no Conversation entry either), the
// same "hub-internal, revisit for robot parity later" call scheduledJobs
// made; see lib/conversationHistory.ts for the visibility and retention
// rules built on top of this table.
export const conversationTurns = sqliteTable("conversation_turns", {
  id: text("id").primaryKey(),
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  surface: text("surface").notNull(),
  userText: text("user_text").notNull(),
  replyText: text("reply_text").notNull(),
  source: text("source").notNull(), // "safety_refuse" | "skill" | "skill_error" | "model"
  skillId: text("skill_id"),
  safetyFlagged: integer("safety_flagged", { mode: "boolean" }).notNull().default(false),
  safetyAction: text("safety_action").notNull(), // "allow" | "allow_with_resources" | "refuse"
  // Captured at write time, not re-derived by joining to `people` later:
  // a person's role can change, and this must reflect who they were when
  // they spoke, the same "recorded, not recomputed" reasoning
  // memory-record scoping already uses.
  minorSpeaker: integer("minor_speaker", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

// The model-provisioning download-job queue (4.11's deferred "download
// queue" gap, spec/llm/README.md): one row per catalog model id a
// household has ever chosen, tracking a real multi-phase job (fetch the
// engine binary if missing, fetch the GGUF, verify both, spawn, run the
// post-load check) so progress survives a browser refresh and a crash
// mid-download resumes rather than restarting silently. Not a spec 3.1
// record type (chapter 3's record table has no download-job entry
// either), the same "hub-internal, revisit for robot parity later" call
// `scheduledJobs` and `conversationTurns` already made.
export const modelDownloadJobs = sqliteTable("model_download_jobs", {
  modelId: text("model_id").primaryKey(),
  status: text("status").notNull(), // queued|downloading_engine|downloading_model|verifying|loading|testing|ready|failed
  phase: text("phase").notNull(),
  completedBytes: integer("completed_bytes").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
  error: text("error"),
  postLoadCheck: text("post_load_check"), // JSON: { estimatedBytes, actualBytes, driftPct }
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const scheduledJobs = sqliteTable("scheduled_jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // "skill" | "core"
  packageId: text("package_id").notNull(),
  job: text("job").notNull(),
  personId: text("person_id").references(() => people.id),
  inputs: text("inputs").notNull(),
  when: text("when").notNull(),
  recurring: integer("recurring", { mode: "boolean" }).notNull().default(false),
  nextRunAt: text("next_run_at").notNull(),
  status: text("status").notNull().default("pending"), // "pending" | "done" | "cancelled"
  createdAt: text("created_at").notNull(),
  lastRunAt: text("last_run_at"),
  lastError: text("last_error"),
});
