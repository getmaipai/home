import { sqliteTable, text, integer, real, blob, primaryKey, index } from "drizzle-orm/sqlite-core";

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
  // Step 10 (session-a-intelligence.md): "the portability half that lives
  // in your files" - person.schema.json's own hlc field, set from
  // lib/hlc.ts on every write (create, profile edit, role change, delete)
  // the same way memory_records/conversations already do.
  hlc: text("hlc").notNull(),
  // Step 7: disabled-but-present, distinct from deletedAt (a tombstone).
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // Step 7: meaningful only for role "guest" (lib/personShape.ts enforces
  // this, the same convention person.schema.json's own conditionals use).
  guestExpiresAt: text("guest_expires_at"),
  // Step 7: set once, never cleared - lib/personLifecycle.ts's
  // memorializePerson() is the only writer.
  memorializedAt: text("memorialized_at"),
});

// A person's sign-in secret (PIN or password, same hashing either way, see
// lib/secret.ts). Separate from `people` so the profile picker's public
// listing query never has to project a hash column out by hand. Not every
// person has one: 4.1 says a PIN-free profile is allowed for a non-admin
// role (the household picker), so this is 0-or-1 rows per person, not
// 1-to-1.
// secretHash is nullable as of step 6: a person can be passkey-only (4.1,
// "the owner with a passkey or password") with no PIN/password at all,
// but the shared failedAttempts/lockedUntil lockout counter below still
// needs a row to live on for their passkey ceremonies - see
// lib/credentialLockout.ts's own header for why this one row is shared
// across every credential type rather than one lockout table per type.
export const personCredentials = sqliteTable("person_credentials", {
  personId: text("person_id")
    .primaryKey()
    .references(() => people.id),
  secretHash: text("secret_hash"),
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
  // Step 6: "Sessions per device under Profile with revoke" needs
  // something recognizable to show ("Chrome on macOS") - captured once
  // at issue time (lib/session.ts), never re-parsed live, so a person's
  // list stays stable even if they change browsers on the same device.
  userAgent: text("user_agent"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

// Session C step 8 (session-c-brain-and-voice.md): "authenticated by a
// device token (F's deviceTokens.ts; a per-person API token setting
// until it lands)" - F's real device-token table (session-f-platform-
// and-trust.md step 6) does not exist yet, so this is the interim
// mechanism `/v1/chat/completions` and the Wyoming satellite server both
// authenticate against. Deliberately its own table, not a `secret: true`
// settings value the way `voice.hf_token` is stored: a settings value
// round-trips (it can be decrypted and shown back), which is exactly
// wrong for a bearer credential - this follows `sessions`' own shape
// instead (a one-way SHA-256 hash, never the raw token, verified the
// same way lib/session.ts's hashSessionToken() already is), the org's
// own "one-way secrets are hashed... never encrypted" rule applied to a
// long-lived API token instead of a short PIN. One token per person at a
// time (generating a new one replaces the old, `tokenHash` unique) -
// simpler than a list, and matches the plan's own singular "a per-person
// API token." `expiresAt` follows lib/deviceTokens.ts's own year-long TTL
// (CLAUDE.md: "every stored credential has a status, an expiry, and a
// one-click revoke" - a leaked bearer token with no expiry never dies on
// its own, matching that rule was a code-review finding on this table's
// first version, fixed here rather than deferred).
export const personApiTokens = sqliteTable("person_api_tokens", {
  personId: text("person_id")
    .primaryKey()
    .references(() => people.id),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  lastUsedAt: text("last_used_at"),
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
// row, one field set" shape. Never hard-deleted at all, as of step 10
// (session-a-intelligence.md): `forget()` used to be the one real DELETE
// (2.2's privacy architecture, the deliberate per-person erasure right),
// but a hard delete cannot be told apart from "never existed" once a
// robot or a second hub syncs - a device offline during the forget could
// resurrect the record right back. `forget()` now tombstones instead
// (status: archived, text and embeddingSpace wiped, deletedAt set),
// keeping the row itself as proof the erasure happened.
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
  // Step 10: hlc set from lib/hlc.ts on every real state change (an
  // insert, a status/tier/text change) - NOT on a plain usage bump
  // (uses/lastUsedAt from a recall touching this record), a deliberate
  // exclusion documented at bumpMatchUsage() itself: hlc exists to
  // resolve conflicts on the record's actual synced content, and
  // stamping it on every read-driven usage bump would make a purely
  // local read look like a newer edit than a genuine concurrent one.
  hlc: text("hlc").notNull(),
  // Set only by forget() (a tombstone) - distinct from a PERSON's own
  // deletedAt (people.deletedAt): this is about one memory, never the
  // whole person. isNull(deletedAt) is NOT how active-vs-tombstoned is
  // checked day to day (status = 'active' already does that everywhere
  // recall/list/similarByVector query); this column exists specifically
  // for exportPerson() to skip tombstones without a second status value.
  deletedAt: text("deleted_at"),
});

// Step 5's real vector store: never a spec-shaped record itself (the
// spec's own memory-record.schema.json comment already says why -
// "embeddings themselves never sync, embedding_space only names the
// space" - so this is hub-internal, the same "recognized but not spec-
// synced" posture conversation_turns/scheduled_jobs already have.
// `space` names the embedding model (`llm.ts`'s `embed()` reports the
// real one at call time, "nomic-embed-text-v1.5" today, "stub-embed" in
// tests - never hardcoded here); `vector` is a raw Float32 buffer (4
// bytes per dim, `dims` says how many), brute-force cosine in JS at
// household scale per the plan's own words, not sqlite-vec or any ANN
// index this scale doesn't need yet.
export const memoryEmbeddings = sqliteTable("memory_embeddings", {
  memoryId: text("memory_id")
    .primaryKey()
    .references(() => memoryRecords.id),
  space: text("space").notNull(),
  dims: integer("dims").notNull(),
  vector: blob("vector", { mode: "buffer" }).notNull(),
  hlc: text("hlc").notNull(),
});

// The retry queue for a record written while the embed backend was down
// (step 5: "queue the id in a pending_embeddings list, a core job
// retries every minute"). One row per memory record still waiting, not
// a log of every attempt - a record that successfully embeds is simply
// removed.
export const pendingEmbeddings = sqliteTable("pending_embeddings", {
  memoryId: text("memory_id")
    .primaryKey()
    .references(() => memoryRecords.id),
  queuedAt: text("queued_at").notNull(),
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
// Conversations (4.14, session-a-intelligence.md step 3): the thread
// itself, spec-shaped (spec/schemas/conversation.schema.json) unlike
// conversation_turns below, which stays hub-internal - the individual
// turns remain a flat per-turn log; this is what a title, a rolling
// summary, and open/closed/deleted lifecycle hang off. One open
// conversation per (person, surface) at a time in practice, enforced by
// lib/conversationHistory.ts's resolveOrCreateConversation(), not a DB
// constraint here (a closed or deleted conversation for the same pair
// may coexist, same as any append-only history).
export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    surface: text("surface").notNull(),
    companionId: text("companion_id"),
    title: text("title"),
    status: text("status").notNull().default("open"), // open|closed|deleted
    summary: text("summary"),
    summaryThroughTurn: text("summary_through_turn"),
    source: text("source").notNull().default("hub"), // hub|local
    // Session C step 2: JSON-encoded PendingAsk (turnEngine.ts) or null.
    // Set either by a Tier 2 tool proposal naming a `consequential`
    // package (waiting on the person's yes/no) or by a recipe result's
    // own `ask`/`confirm` field (spec/schemas/result.schema.json - typed
    // there since step 6, session-a-intelligence.md, but no recipe
    // interpreter step can SET either field yet: spec/interpreters/**
    // is Session D's file, so this consumption path is real and tested
    // against a hand-built PluginResult, genuinely unreachable by any
    // bundled package until D adds the op). Matched against the NEXT
    // utterance, before the floor, then cleared either way - never left
    // open past one turn.
    pendingAsk: text("pending_ask"),
    hlc: text("hlc").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  // resolveOrCreateConversation()/createConversation()/listConversations()/
  // clearConversations() all filter by (person_id, surface, status) on
  // every turn - a code review, 2026-09-05, found conversation_turns got
  // its own index in this same diff but this table was missed.
  (table) => [index("conversations_person_surface_status_idx").on(table.personId, table.surface, table.status)],
);

// Conversation history (4.14, split): one row per completed turnEngine
// turn, kept per person and per surface. Not a spec 3.1 record type
// today (chapter 3's record table has no Conversation-turn entry either,
// distinct from the `conversations` thread record above), the same
// "hub-internal, revisit for robot parity later" call scheduledJobs
// made; see lib/conversationHistory.ts for the visibility and retention
// rules built on top of this table.
export const conversationTurns = sqliteTable(
  "conversation_turns",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    surface: text("surface").notNull(),
    // Nullable: a migration backfills one conversation per (person, surface)
    // for every pre-existing row (step 3), but every real write path now
    // sets this - lib/conversationHistory.ts's logTurn() requires it as a
    // real parameter. Only nullable for the backfilled history's sake.
    conversationId: text("conversation_id").references(() => conversations.id),
    userText: text("user_text").notNull(),
    replyText: text("reply_text").notNull(),
    source: text("source").notNull(), // "safety_refuse" | "plugin" | "plugin_error" | "command" | "command_error" | "model" | "confirm"
    pluginId: text("plugin_id"),
    commandId: text("command_id"),
    safetyFlagged: integer("safety_flagged", { mode: "boolean" }).notNull().default(false),
    safetyAction: text("safety_action").notNull(), // "allow" | "allow_with_resources" | "refuse"
    // Captured at write time, not re-derived by joining to `people` later:
    // a person's role can change, and this must reflect who they were when
    // they spoke, the same "recorded, not recomputed" reasoning
    // memory-record scoping already uses.
    minorSpeaker: integer("minor_speaker", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    // The memory judge's own poison guard (step 6, session-a-
    // intelligence.md): null means "not judged yet" (every pre-existing
    // row, and every new one until the core job reaches it), "done" and
    // "failed" are terminal - a turn is judged at most once, ever, never
    // re-queued by a later run. judgeAttempts counts extraction failures
    // only (a dedupe-round failure never counts, lib/memoryJudge.ts's own
    // header explains why); it hits judge_attempts_max and flips to
    // "failed" rather than retrying forever on a turn the model can't
    // seem to parse.
    judgeStatus: text("judge_status"),
    judgeAttempts: integer("judge_attempts").notNull().default(0),
    // Session C step 1: null for every non-plugin turn (a command, the
    // model, a safety refusal). "pattern"/"embedding"/"keyword" for a
    // plugin turn - which tier of route()'s decision actually fired it,
    // and its own score (1.0 for a pattern; the real cosine or the
    // keyword-overlap fallback score otherwise) - lib/conversationHistory.ts's
    // routingStats() aggregates these; RoutingStatsSection.tsx (Session E's
    // file) doesn't render them yet, a noted frontend follow-up.
    routingTier: text("routing_tier"),
    routingScore: real("routing_score"),
    // Step 10: not a spec-shaped record itself (conversation_turns stays
    // hub-internal, see the table's own header above), but the plan's
    // own text still asks for it here so a synced conversation's
    // individual turns carry a real clock stamp too, not just the
    // conversation thread they belong to.
    hlc: text("hlc").notNull(),
  },
  // buildConversationWindow() and maybeRefreshConversationSummary() (step 3)
  // both filter by conversation_id on every model-routed turn - the
  // hottest path in the app (a code review, 2026-09-05, flagged the
  // missing index: a full table scan on every turn as history grows).
  (table) => [
    index("conversation_turns_conversation_id_idx").on(table.conversationId),
    // The judge's own core job scans for `source = 'model' AND
    // judge_status IS NULL` every tick (lib/memoryJudge.ts) - without
    // this, that scan is a full table scan of every turn the household
    // has ever had, not just the still-unjudged ones.
    index("conversation_turns_judge_status_idx").on(table.source, table.judgeStatus),
  ],
);

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

// Cloned voices (2026-09-04, voice cloning): a household member's own
// uploaded audio sample, usable as `tts.voice_id` the same way a preset
// or community-catalog voice is - Pocket TTS's own `/tts` route accepts
// any http(s) URL for `voice_url` (spec/voice/ts/client.ts), and a URL
// back to this hub's own file-serving route (routes/voice.ts's
// `GET /cloned/:id/file`) satisfies that unchanged, no new mechanism on
// the Pocket TTS side needed. Household-wide visibility, not per-person:
// the same "anyone can select any voice regardless of who found it"
// shape the community catalog already has (VoiceCatalogSection.tsx) - a
// shared family hub, not a personal library. Deletion is creator or
// owner/admin only (routes/voice.ts). Not backed up (lib/backup.ts's
// VACUUM INTO only covers hub.db, not files under data/) - a real,
// documented gap, unlike the wake-word models this shares a storage
// shape with: those are re-downloadable, a person's recorded voice is
// not (docs/dev.md).
export const clonedVoices = sqliteTable("cloned_voices", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => people.id),
  label: text("label").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: text("created_at").notNull(),
});

export const scheduledJobs = sqliteTable("scheduled_jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // "plugin" | "core"
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

// The `command` primitive (2026-09-05, the third "Naming: skill, plugin,
// command, connector" item): "when I say X, do Y," authored by a
// household at runtime, not a filesystem package - see lib/commands.ts's
// own header for why this lives here rather than as a spec 3.1 record
// type, the same call scheduledJobs above already made for the identical
// reason. `trigger` is matched exactly (case-insensitive, trimmed, no
// wildcard - lib/turnEngine.ts's own matchPattern with no `*`), never
// fuzzy: a command is a deliberate, household-authored phrase, not a
// guess. Unique per household (enforced at the lib layer, not a DB
// constraint, since "unique" here means case-insensitive/trimmed
// equality, which SQLite's own UNIQUE can't express directly).
export const commands = sqliteTable("commands", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => people.id),
  trigger: text("trigger").notNull(),
  minRole: text("min_role").notNull(),
  actionKind: text("action_kind").notNull(), // "reply" | "home_call_service"
  actionData: text("action_data").notNull(), // JSON, shape depends on actionKind
  createdAt: text("created_at").notNull(),
});

// The notification system (2026-09-05), scoped narrowly, the same
// "real, hub-internal, not a spec 3.1 record type" call scheduledJobs
// and commands above already made (see lib/notifications.ts's own
// header for the reasoning and what's deferred - quiet hours, non-hub
// channels, package-declared types). One row per (type, recipient): even
// a household-wide event fans out to one row per person, since read/
// dismiss state (getmaipai/.github/docs/NOTIFICATIONS.md: "to the person
// on every device they are signed into, deduplicated by event id") is
// inherently per-person, never shared.
export const notificationDeliveries = sqliteTable("notification_deliveries", {
  id: text("id").primaryKey(),
  typeId: text("type_id").notNull(),
  recipientId: text("recipient_id")
    .notNull()
    .references(() => people.id),
  text: text("text").notNull(),
  channels: text("channels").notNull(), // JSON string[] - channels actually attempted
  createdAt: text("created_at").notNull(),
  readAt: text("read_at"),
  dismissedAt: text("dismissed_at"),
});

// Session F (platform and trust), step 1. Mirrors
// spec/schemas/issue.schema.json: the Health/Repairs surface's backing
// store. Upserted on `(source, key)` by lib/issues.ts's raiseIssue() -
// enforced there, not by a DB UNIQUE constraint, since an upsert needs to
// preserve the original `created_at` while refreshing everything else,
// which a plain `ON CONFLICT` can't express without also naming every
// column to keep.
export const issues = sqliteTable("issues", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  key: text("key").notNull(),
  severity: text("severity").notNull(), // "info" | "warning" | "error"
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  fix: text("fix"), // JSON: { label, action } | null
  learnMore: text("learn_more"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  dismissedAt: text("dismissed_at"),
  hlc: text("hlc").notNull(),
});

// --- Session D: packages and the store ------------------------------
//
// One row per bundled/installed package, tracking bronze's "a smoke
// failure leaves the package installed but status: disabled" rule
// (docs/PACKAGES.md, session-d-packages-and-store.md step 1). A package
// with no row here is assumed "enabled" and never smoke-tested yet -
// lib/smoke.ts's own runSmoke() is what creates the first row. Not a
// spec 3.1 record type: purely a hub-local operational fact about a
// package the way scheduledJobs/commands already are for their own
// features, not household data that syncs to the robot.
export const packageStatus = sqliteTable("package_status", {
  packageId: text("package_id").primaryKey(),
  status: text("status").notNull().default("enabled"), // "enabled" | "disabled"
  lastSmokeAt: text("last_smoke_at"),
  smokeOk: integer("smoke_ok", { mode: "boolean" }),
  smokeMessage: text("smoke_message"),
});

// Session F, step 5 (trust on the LAN). Who this hub is, independent of
// how you reached it - lib/hubIdentity.ts's own header has the reasoning
// (a client must be able to tell "the hub, via this LAN IP" from "some
// other machine that happens to answer on this address"). A single row
// (id is always the literal string "hub"), not the household settings
// store: `instance_id` must never be user-editable through a generic PUT
// /api/settings the way a household's own preferences are - rotating it
// would sign out every device that has it cached, and nothing about
// identity belongs in a registry meant for "the household's own
// preferences." Hub-internal, like scheduledJobs/commands/
// notificationDeliveries above, not a spec 3.1 record type.
export const hubIdentity = sqliteTable("hub_identity", {
  id: text("id").primaryKey(),
  instanceId: text("instance_id").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

// Session F, step 5. lib/hubEndpoints.ts's admin-managed address book
// rows (Admin -> Server -> Addresses, ported from the archived legacy
// hub) - detected LAN/Tailscale addresses are computed at read time, not
// stored; only rows an admin typed in live here. Hub-internal, the same
// reasoning hubIdentity above gives.
export const hubEndpoints = sqliteTable("hub_endpoints", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  kind: text("kind").notNull(), // "lan" | "overlay" | "public"
  priority: integer("priority").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// --- Session F, step 6: passkeys, device tokens, Quick Connect, sessions ---
//
// Mirrors spec/schemas/device.schema.json - a Device row is created the
// first time a device token is minted for it (lib/deviceTokens.ts), and
// deleting it revokes every token pointing at it. capabilities and
// watermarks are stored as JSON text (sqlite has no array/object column);
// lib/devices.ts is the only place that (de)serializes them.
export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // "robot" | "pod" | "tv" | "phone" | "desktop" | "browser"
  name: text("name").notNull(),
  area: text("area"),
  capabilities: text("capabilities").notNull().default("[]"), // JSON string[]
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  watermarks: text("watermarks").notNull().default("{}"), // JSON object
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  hlc: text("hlc").notNull(),
});

// Long-lived per-device credentials (lib/deviceTokens.ts, ported from the
// archived legacy hub's deviceToken.ts, principle 8): a native/TV client
// trades one of these for a session cookie on whichever address answers,
// so a change of address doesn't look like a sign-out. Never the raw
// token at rest, only its hash - the same "returned exactly once" shape
// sessions.tokenHash already uses.
export const deviceTokens = sqliteTable("device_tokens", {
  id: text("id").primaryKey(),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  lastSeenAt: text("last_seen_at"),
  lastSeenUrl: text("last_seen_url"),
  createdAt: text("created_at").notNull(),
});

// WebAuthn credentials (lib/passkeys.ts, @simplewebauthn/server). A
// person can register several (a phone's platform authenticator, a
// security key), so this is one row per credential, not per person -
// unlike person_credentials above, which is the single PIN/password hash.
// publicKey is a base64url-encoded COSE public key (never a private key -
// WebAuthn's whole point is the private key never leaves the
// authenticator); counter guards against a cloned authenticator replaying
// an old assertion.
export const passkeyCredentials = sqliteTable("passkey_credentials", {
  id: text("id").primaryKey(), // the credential id itself (base64url), not a minted id
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  publicKey: text("public_key").notNull(), // base64url COSE key
  counter: integer("counter").notNull().default(0),
  transports: text("transports").notNull().default("[]"), // JSON string[]
  deviceType: text("device_type").notNull(), // "singleDevice" | "multiDevice"
  backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
  name: text("name").notNull(), // "iPhone Face ID", chosen at registration
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
});

// TOTP (lib/totp.ts, `otpauth`), optional for owner and admin only (4.1).
// One row per person, like person_credentials - a person has at most one
// TOTP secret. `secret` is AES-256-GCM-encrypted via lib/secrets.ts
// (CLAUDE.md > Credentials and secrets: "any reversible secret the app
// stores... is encrypted with the keystore"), the same treatment
// householdCa.ts's private keys got after a code review found them
// plaintext (step 5) - this file starts from that lesson rather than
// repeating it. `enabled` stays false until the person proves they can
// generate a real code with it (enrollment isn't complete on secret
// creation alone, or a person who never finished scanning the QR would
// get locked out of their own account on their next sign-in).
export const totpSecrets = sqliteTable("totp_secrets", {
  personId: text("person_id")
    .primaryKey()
    .references(() => people.id),
  secretEncrypted: text("secret_encrypted").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  // A code review (2026-09-06) found verifyTotp() stateless - a valid
  // code stays valid for its whole ~90s window (30s step, +/-1 step
  // tolerance) and could be replayed any number of times within it. The
  // last successfully-used 30s-period counter, so a step is accepted at
  // most once - the standard TOTP anti-replay measure (RFC 6238 section
  // 5.2's own recommendation).
  lastUsedStep: integer("last_used_step"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// --- Session F, step 7: entities, relationships, grants, approvals ---
//
// Mirrors spec/schemas/entity.schema.json. aliases is JSON text (sqlite
// has no array column); lib/entities.ts is the only place that
// (de)serializes it.
export const entities = sqliteTable("entities", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // "person" | "pet" | "place" | "organization" | "thing"
  name: text("name").notNull(),
  aliases: text("aliases").notNull().default("[]"), // JSON string[]
  description: text("description"),
  placeKind: text("place_kind"), // "map" | "area" | null
  parentId: text("parent_id"),
  accountPersonId: text("account_person_id").references(() => people.id),
  source: text("source").notNull(), // "hub" | "local" | "imported" | "inferred"
  confirmedByPersonId: text("confirmed_by_person_id").references(() => people.id),
  scope: text("scope").notNull().default("household"), // "household" | "person"
  person: text("person").references(() => people.id),
  sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  hlc: text("hlc").notNull(),
});

// Mirrors spec/schemas/relationship.schema.json. evidence is JSON text,
// same reason entities.aliases is.
export const relationships = sqliteTable("relationships", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  fromId: text("from_id")
    .notNull()
    .references(() => entities.id),
  toId: text("to_id")
    .notNull()
    .references(() => entities.id),
  status: text("status").notNull(),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  expiredAt: text("expired_at"),
  source: text("source").notNull(), // "stated" | "imported" | "inferred"
  statedByPersonId: text("stated_by_person_id").references(() => people.id),
  confidence: real("confidence"),
  confirmedByPersonId: text("confirmed_by_person_id").references(() => people.id),
  evidence: text("evidence").notNull().default("[]"), // JSON string[]
  scope: text("scope").notNull().default("person"), // "household" | "person"
  person: text("person").references(() => people.id),
  sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  hlc: text("hlc").notNull(),
});

// Mirrors spec/schemas/grant.schema.json. Deliberately its own table, not
// a shared "edges" table with relationships - the schema's own header
// explains why: a Grant is never inferred, and mixing this store with
// one that can be is how an inference bug becomes a privilege
// escalation.
export const grants = sqliteTable("grants", {
  id: text("id").primaryKey(),
  person: text("person")
    .notNull()
    .references(() => people.id),
  action: text("action").notNull(),
  effect: text("effect").notNull(), // "allow" | "deny"
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  grantedByPersonId: text("granted_by_person_id")
    .notNull()
    .references(() => people.id),
  reason: text("reason"),
  acknowledgedAt: text("acknowledged_at"),
  acknowledgedByPersonId: text("acknowledged_by_person_id").references(() => people.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  hlc: text("hlc").notNull(),
});

// Hub-internal (not a spec 3.1 record type, the same reason scheduledJobs/
// commands/notificationDeliveries above aren't): the approval queue
// (plan's "Ask to Install, Ask to Browse"). One row per request; a
// parent's decision is final and the row keeps its own history rather
// than being deleted, the same "resolved but visible" shape issues use.
export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // "install_package" | "browse_url" | ...
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  details: text("details").notNull().default("{}"), // JSON, kind-specific
  status: text("status").notNull().default("pending"), // "pending" | "approved" | "denied"
  decidedByPersonId: text("decided_by_person_id").references(() => people.id),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull(),
});

// Session C (brain and voice), step 1. Tier 1 routing's real embedding
// store, the routing-specific twin of `memoryEmbeddings` above (same
// buffer shape, `space`/`dims`/`vector`/`hlc`). Keyed by
// (package_id, example_hash, space) rather than a single-column primary
// key: a package has several `routing.examples` entries, not one, and
// the composite key is what makes "a changed example re-embeds, an
// unchanged one is a pure lookup" possible - lib/routing.ts hashes each
// example's text and only calls `llm.embed` for hashes not already
// here. No foreign key to a packages table: packages are files on disk
// (lib/plugins.ts's `listPackageIds()`), never a DB row, the same
// reason `manifest.json` itself is never mirrored into SQLite.
export const routingEmbeddings = sqliteTable(
  "routing_embeddings",
  {
    packageId: text("package_id").notNull(),
    exampleHash: text("example_hash").notNull(),
    space: text("space").notNull(),
    example: text("example").notNull(),
    dims: integer("dims").notNull(),
    vector: blob("vector", { mode: "buffer" }).notNull(),
    hlc: text("hlc").notNull(),
  },
  (table) => [primaryKey({ columns: [table.packageId, table.exampleHash, table.space] })],
);

// Session F, step 8. One row per backup target ("2.5: a failure raises
// a Repairs item and two in a row notify admins"): tracked per target
// (id is the literal "local", "smb", or "hub") because a failing NAS
// mount must not mask - or get masked by - the local target still
// working fine, and vice versa. Hub-internal, the same reasoning
// hubIdentity/scheduledJobs above give.
export const backupHealth = sqliteTable("backup_health", {
  id: text("id").primaryKey(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastFailureAt: text("last_failure_at"),
  lastFailureMessage: text("last_failure_message"),
  lastSuccessAt: text("last_success_at"),
});

// Session F, step 8. A configured `smb` target (a NAS share the admin
// has already mounted at the OS level - this hub is not an SMB client,
// it just copies encrypted archives into a directory someone else's
// mount already made available, the same "declared with scan paths"
// shape plan 4.15's NAS mounts use). Only one row per kind exists in
// practice today (id is the literal kind), but a table rather than a
// household setting: `path` is a filesystem detail an admin sets once
// for the whole house, not a per-person preference, and a future
// multi-NAS household needs more than one row without a shape change.
export const backupTargets = sqliteTable("backup_targets", {
  id: text("id").primaryKey(), // "smb" today; "local" and "hub" need no config row
  path: text("path").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Session F, step 8: "hub as the interface a robot will use" - a paired
// device pushes ITS OWN already-encrypted backup archive here; this hub
// never has the robot's own backup key, so it is cold storage only,
// never restorable or decryptable from this side. One row per received
// archive (not just files on disk) so GET /api/backups?target=hub can
// list them per device without re-deriving createdAt/bytes from
// filesystem stat calls scattered across every paired device's own
// subdirectory.
export const receivedBackups = sqliteTable("received_backups", {
  id: text("id").primaryKey(),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  filename: text("filename").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: text("created_at").notNull(),
});

// Step 6 (session-d-packages-and-store.md): the store's own active-
// install record. A package with no row here resolves to its bundled
// copy under `backend/packages/<id>/` (lib/packageResolve.ts); a row
// means the store installed a version of it into
// `data/packages/<id>/versions/<version>/` (lib/paths.ts's
// `installedPackageVersionDir`) and that version is what actually runs,
// bundled or not - "weather installed from the local index" (this
// step's own acceptance test) means THIS package's own bundled copy
// gets overridden by a row here. `previousVersion` is rollback's whole
// implementation: the prior version's files are never deleted until a
// NEWER install replaces them, so rollback is just writing this row
// back, no re-download. Hub-internal, like packageStatus above, not a
// spec 3.1 record type.
export const packageInstalls = sqliteTable("package_installs", {
  packageId: text("package_id").primaryKey(),
  version: text("version").notNull(),
  previousVersion: text("previous_version"),
  channel: text("channel").notNull().default("stable"), // "stable" | "beta"
  sourceCommit: text("source_commit").notNull(),
  permissions: text("permissions").notNull(), // JSON string[] - the permission set this version was installed under
  installedAt: text("installed_at").notNull(),
});

// The store's own rollback defense (lib/storeIndex.ts): the highest
// `version` ever seen for each TUF role, so a validly-signed but
// WITHDRAWN older index (the "rolled-back index" tamper case,
// docs/PACKAGES.md) is refused even though its own expiry is still in
// the future - an expiry check alone only catches staleness, never a
// deliberate rollback to an older, still-unexpired file. Persisted (not
// just in-memory) so a reboot can't reset what "the highest version
// seen" means and let a rollback back in.
export const storeIndexState = sqliteTable("store_index_state", {
  role: text("role").primaryKey(), // "root" | "targets" | "timestamp"
  version: integer("version").notNull(),
  updatedAt: text("updated_at").notNull(),
});
