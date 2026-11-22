// CODE-GIT-01: a person's git host connections (spec git-connection). The token is a write-only secret kept encrypted with the
// household keystore (lib/secrets); no function here that a route calls returns it, and nothing logs it. Only `gitCredentialFor`
// (host-side git, lib/gitHost.ts) reads it back, and only for an active connection.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { gitConnections, people } from "@/db/schema";
import { newGitConnectionId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { encryptSecret, decryptSecret } from "@/lib/secrets";
import { guardedGet, RateLimited, RedirectLimitError } from "@/lib/outbound";
import { SsrfBlockedError, type DnsLookup } from "@maipai/core/src/ssrfGuard";
import { codeAdmission } from "@/lib/apiKeys";
import type { PersonRow } from "@/types";

export type GitConnectionKind = "github" | "gitea";
export type GitConnectionStatus = "active" | "expired" | "revoked" | "failing";
type Row = typeof gitConnections.$inferSelect;

/** What a revoked connection keeps in place of its host and account: the record stays (spec shape), the details do not. */
const REMOVED = "removed";
export const GITHUB_HOST = "github.com";
const GITHUB_API = "https://api.github.com/user";
const HOST_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*(:[0-9]{1,5})?$/;
const TOKEN_PATTERN = /^[\x21-\x7e]{8,512}$/; // printable, no spaces: a pasted token, never a sentence

// TODO(CODE-GIT-01, device flow): GitHub's device flow (a person approves a code at github.com instead of pasting a token) is left out of
// this slice. It would end in the same `storeConnection` call below, so adding it later changes no table, route response or git code.

export const CreateGitConnectionInput = z.object({
  kind: z.enum(["github", "gitea"]),
  /** Required for Gitea (the household's own server); ignored for GitHub, which is always github.com. */
  host: z.string().trim().toLowerCase().max(253).optional(),
  /** A fine-grained access token limited to the repositories the person chooses. */
  token: z.string().trim(),
}).strict();

/** The wire shape (spec git-connection plus nothing secret). */
export interface GitConnectionWire {
  id: string; person_id: string; kind: GitConnectionKind; host: string; account: string; status: GitConnectionStatus;
  expires_at: string | null; created_at: string; provenance: string; hlc: string;
}
/** What an admin sees (rule 6a): no host, account or repository name. */
export interface GitConnectionAdminWire { id: string; person_id: string; kind: GitConnectionKind; status: GitConnectionStatus; created_at: string; expires_at: string | null }

export class GitConnectionError extends Error {}

/** Why a person may not connect a git host now. Git connections follow the Coding switch and the person's `use:code` access, not the API-key toggle. */
export function gitConnectionRefusal(person: PersonRow): string | null {
  const admission = codeAdmission(person);
  if (admission === "not_allowed") return "Coding is not allowed for you. Ask an admin to check your Coding access in Settings.";
  if (admission === "coding_off") return "Coding is turned off for this household. Ask an admin to turn it on in Settings, Coding.";
  if (admission === "coding_paused") return "Coding is paused for this household. Try again when an admin resumes it.";
  // TODO(CODE-GIT-01, design 3.7): a child or teen connects a git host only when their grant allows git hosts; that grant is not built yet, so for now they cannot.
  if (person.role === "child" || person.role === "teen") return "Git hosts cannot be connected from this profile yet. Ask an admin about Coding access.";
  return null;
}

function statusOf(row: Row): GitConnectionStatus {
  if (row.revokedAt || row.status === "revoked") return "revoked";
  if (row.expiresAt && Date.parse(row.expiresAt) <= Date.now()) return "expired";
  return row.status === "failing" ? "failing" : "active";
}
function wire(row: Row): GitConnectionWire {
  return { id: row.id, person_id: row.personId, kind: row.kind, host: row.host, account: row.account, status: statusOf(row),
    expires_at: row.expiresAt, created_at: row.createdAt, provenance: row.provenance, hlc: row.hlc };
}

export interface VerifyDeps { fetch?: typeof fetch; dnsLookup?: DnsLookup }
interface Verified { account: string; expiresAt: string | null }

function verifyTarget(kind: GitConnectionKind, host: string): URL {
  return new URL(kind === "github" ? GITHUB_API : `https://${host}/api/v1/user`);
}

/** One read-only call to the host's "who am I" endpoint through the outbound guard (https only, public addresses only, paced, no cookies). */
export async function verifyGitToken(kind: GitConnectionKind, host: string, token: string, deps: VerifyDeps = {}): Promise<Verified> {
  const target = verifyTarget(kind, host);
  let response: Response;
  try {
    response = await guardedGet(target, {
      schemePolicy: "https", bucket: { prefix: "gitverify", capacity: 5, refillPerSecond: 0.2 }, redirectCap: 0,
      signal: AbortSignal.timeout(10_000), accept: "application/json",
      headers: { Authorization: kind === "github" ? `Bearer ${token}` : `token ${token}` },
      ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(deps.dnsLookup ? { dnsLookup: deps.dnsLookup } : {}),
    });
  } catch (e) {
    if (e instanceof SsrfBlockedError) throw new GitConnectionError("That address is not a public https host Home can reach. Use the host's public address, for example git.example.com.");
    if (e instanceof RateLimited) throw new GitConnectionError("Too many checks in a short time. Wait a few seconds and try again.");
    if (e instanceof RedirectLimitError) throw new GitConnectionError("That host redirected the check. Use the host's exact address, for example git.example.com.");
    throw new GitConnectionError("Home could not reach that host. Check the address and your connection, then try again.");
  }
  if (response.status === 401 || response.status === 403) { await response.body?.cancel().catch(() => undefined); throw new GitConnectionError("The host rejected this token. Make a new token with access to your repositories and try again."); }
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new GitConnectionError("The host did not accept the check. Confirm the address is a GitHub or Gitea server and try again."); }
  let login: unknown;
  try { login = ((await response.json()) as { login?: unknown }).login; } catch { login = undefined; }
  if (typeof login !== "string" || !login.trim() || login.length > 100) throw new GitConnectionError("The host answered, but not like a GitHub or Gitea server. Confirm the address and try again.");
  const header = response.headers.get("github-authentication-token-expiration"); // GitHub tells a fine-grained token's expiry; Gitea tokens carry none
  const parsed = header ? Date.parse(header) : NaN;
  return { account: login.trim(), expiresAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString() };
}

/** Verifies the token with one read-only call, then stores it encrypted. Returns the wire record, never the token. */
export async function createGitConnection(person: PersonRow, input: z.input<typeof CreateGitConnectionInput>, deps: VerifyDeps = {}): Promise<GitConnectionWire> {
  const refusal = gitConnectionRefusal(person);
  if (refusal) throw new GitConnectionError(refusal);
  const body = CreateGitConnectionInput.safeParse(input);
  if (!body.success) throw new GitConnectionError("The connection details are invalid. Choose GitHub or Gitea and paste the token.");
  const { kind, token } = body.data;
  const host = kind === "github" ? GITHUB_HOST : body.data.host ?? "";
  if (!HOST_PATTERN.test(host)) throw new GitConnectionError("Enter the Gitea server's address without https:// or a path, for example git.example.com.");
  if (!TOKEN_PATTERN.test(token)) throw new GitConnectionError("That does not look like an access token. Paste only the token, with no spaces, and try again.");
  const verified = await verifyGitToken(kind, host, token, deps);
  return storeConnection(person.id, kind, host, verified, token, "Connected in Settings with an access token");
}

/** The one writer: the token-paste path and the later device flow both end here. */
export function storeConnection(personId: string, kind: GitConnectionKind, host: string, verified: Verified, token: string, provenance: string): GitConnectionWire {
  const at = new Date().toISOString();
  const row = db.insert(gitConnections).values({ id: newGitConnectionId(), personId, kind, host, account: verified.account, status: "active",
    expiresAt: verified.expiresAt, tokenEncrypted: encryptSecret(token), createdAt: at, lastCheckedAt: at, provenance, hlc: nextHlc(), updatedAt: at }).returning().get();
  return wire(row);
}

export function listGitConnections(person: Pick<PersonRow, "id">): GitConnectionWire[] {
  return db.select().from(gitConnections).where(eq(gitConnections.personId, person.id)).all().map(wire).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export function listGitConnectionsForAdmin(person: Pick<PersonRow, "id">): GitConnectionAdminWire[] {
  return listGitConnections(person).map((c) => ({ id: c.id, person_id: c.person_id, kind: c.kind, status: c.status, created_at: c.created_at, expires_at: c.expires_at }));
}

/** Revokes one connection and wipes the stored token. True when the person had it. Used for the person and, with the target's id, for an admin. */
export function revokeGitConnection(personId: string, id: string): boolean {
  const at = new Date().toISOString();
  return db.update(gitConnections).set({ revokedAt: at, status: "revoked", tokenEncrypted: "", host: REMOVED, account: REMOVED, provenance: "Revoked", lastCheckedAt: null, expiresAt: null, updatedAt: at, hlc: nextHlc() })
    .where(and(eq(gitConnections.personId, personId), eq(gitConnections.id, id))).returning({ id: gitConnections.id }).all().length > 0;
}
export function revokeAllGitConnections(personId: string): number {
  const ids = db.select({ id: gitConnections.id }).from(gitConnections).where(eq(gitConnections.personId, personId)).all();
  for (const { id } of ids) revokeGitConnection(personId, id);
  return ids.length;
}

/** Host-side git calls this when a push or clone fails for the token (denied, expired at the host). The connection shows as failing until replaced. */
export function markGitConnectionFailing(personId: string, id: string): void {
  const at = new Date().toISOString();
  db.update(gitConnections).set({ status: "failing", lastCheckedAt: at, updatedAt: at, hlc: nextHlc() })
    .where(and(eq(gitConnections.personId, personId), eq(gitConnections.id, id), eq(gitConnections.status, "active"))).run();
}

export interface GitCredential { id: string; kind: GitConnectionKind; host: string; account: string; token: string }
/** The only reader of the token: for host-side git, for an active (not revoked, expired or failing) connection the person owns. */
export function gitCredentialFor(personId: string, id: string): GitCredential | null {
  const row = db.select().from(gitConnections).where(and(eq(gitConnections.personId, personId), eq(gitConnections.id, id))).get();
  if (!row || statusOf(row) !== "active" || !row.tokenEncrypted) return null;
  // Admission is read NOW, every call: a disabled person, a removed grant, Coding turned off or paused ends use at once.
  const owner = db.select().from(people).where(eq(people.id, personId)).get() as PersonRow | undefined;
  if (!owner || gitConnectionRefusal(owner)) return null;
  return { id: row.id, kind: row.kind, host: row.host, account: row.account, token: decryptSecret(row.tokenEncrypted) };
}
