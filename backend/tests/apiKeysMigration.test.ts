import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { db, sqlite } from "@/db";
import { apiKeys, personApiTokens, people } from "@/db/schema";
import { resolveApiKey } from "@/lib/apiKeys";
import { resetDb } from "./reset-db";
import { newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";

const migration = readFileSync(new URL("../src/db/migrations/0120_api_keys.sql", import.meta.url), "utf8");
test("real migration is idempotent, leaves old rows unread, and upgrades old tokens without breaking reuse", () => {
  resetDb();
  const at = new Date().toISOString(); const id = newPersonId();
  db.insert(people).values({ id, displayName: "Willow", role: "owner", avatarSeed: id, source: "hub", createdAt: at, updatedAt: at, hlc: nextHlc() }).run();
  const secret = "maipai_" + randomBytes(32).toString("hex");
  db.insert(personApiTokens).values({ personId: id, tokenHash: createHash("sha256").update(secret).digest("hex"), createdAt: at, expiresAt: new Date(Date.now() + 86400000).toISOString() }).run();
  sqlite.exec(migration); sqlite.exec(migration);
  const row = db.select().from(apiKeys).get()!;
  expect(row.name).toBe("Voice and Home Assistant");
  expect(row.scopes).toEqual(["turn"]);
  expect(Date.parse(row.expiresAt) - Date.now()).toBeGreaterThan(89 * 86400000);
  db.delete(personApiTokens).run();
  expect(resolveApiKey(secret, "turn")?.id).toBe(id);
  expect(db.select().from(apiKeys).get()!.legacyHash).toBeNull();
  expect(db.select().from(apiKeys).get()!.secretHash).toHaveLength(64);
  expect(resolveApiKey(secret, "turn")?.id).toBe(id);
  expect(resolveApiKey(secret, "code")).toBeNull();
});

test("migration also runs over a minimal pre-migration fixture", () => {
  const fixture = new Database(":memory:");
  try {
    fixture.exec("CREATE TABLE people (id text PRIMARY KEY); CREATE TABLE person_api_tokens (person_id text, token_hash text, created_at text, expires_at text, last_used_at text);");
    fixture.query("INSERT INTO people VALUES (?)").run("person-example");
    fixture.query("INSERT INTO person_api_tokens VALUES (?, ?, ?, ?, NULL)").run("person-example", "a".repeat(64), "2026-10-01T00:00:00Z", "2027-10-01T00:00:00Z");
    fixture.exec(migration); fixture.exec(migration);
    expect(fixture.query("SELECT count(*) AS n FROM api_keys").get()).toEqual({ n: 1 });
    expect(fixture.query("SELECT count(*) AS n FROM person_api_tokens").get()).toEqual({ n: 1 });
  } finally { fixture.close(); }
});
