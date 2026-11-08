// HOUSE-02: secrets for connector instances that are not the legacy `default` Home Assistant keys.
// An `integration` record holds only an opaque reference (`credentialRef`); the secret itself is kept here,
// encrypted at rest with the household key (lib/secrets.ts), in its own scope so the settings listing never sees it.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const SCOPE = "connector-credential";
/** References this store owns. Anything else (for example `home.access_token`) is a household setting. */
export const CONNECTOR_REF_PREFIX = "connector.";

export function isConnectorRef(ref: string): boolean { return ref.startsWith(CONNECTOR_REF_PREFIX); }

export function writeConnectorSecret(ref: string, value: string): void {
  const stored = encryptSecret(JSON.stringify(value));
  const now = new Date().toISOString();
  const existing = db.select().from(settingsValues).where(and(eq(settingsValues.scope, SCOPE), eq(settingsValues.key, ref))).get();
  if (existing) db.update(settingsValues).set({ value: stored, hlc: nextHlc(), updatedAt: now }).where(and(eq(settingsValues.scope, SCOPE), eq(settingsValues.key, ref))).run();
  else db.insert(settingsValues).values({ scope: SCOPE, key: ref, value: stored, hlc: nextHlc(), source: "user", updatedAt: now }).run();
}

export function readConnectorSecret(ref: string): string {
  const row = db.select().from(settingsValues).where(and(eq(settingsValues.scope, SCOPE), eq(settingsValues.key, ref))).get();
  if (!row) return "";
  try { const value: unknown = JSON.parse(decryptSecret(row.value)); return typeof value === "string" ? value : ""; } catch { return ""; }
}

export function deleteConnectorSecret(ref: string): void {
  db.delete(settingsValues).where(and(eq(settingsValues.scope, SCOPE), eq(settingsValues.key, ref))).run();
}
