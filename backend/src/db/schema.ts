import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
