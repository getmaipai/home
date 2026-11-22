import { beforeEach, expect, spyOn, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { gitConnections, people, sessions } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newPersonId } from "@/lib/id";
import { revokeAllGitConnections, createGitConnection, gitCredentialFor, GitConnectionError, listGitConnections, listGitConnectionsForAdmin, markGitConnectionFailing, revokeGitConnection } from "@/lib/gitConnections";
import { setHouseholdSettingValue } from "@/lib/settings";
import { settingsRoutes } from "@/routes/settings";
import { __setMissingCodingPieceForTests } from "@/lib/stackCodingPieces";
import { invalidatePass } from "@/lib/filter/passCache";
import { grants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

const TOKEN = "github_pat_FINEGRAINEDSECRET0123456789";
const publicDns = async () => ({ address: "203.0.113.7", family: 4 });
const app = new OpenAPIHono(); app.route("/api/settings", settingsRoutes);
const calls: { url: string; auth: string | null }[] = [];
function fakeHost(login = "willow", status = 200, expires?: string): typeof fetch {
  return (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    return new Response(status === 200 ? JSON.stringify({ login }) : "no", { status, headers: expires ? { "github-authentication-token-expiration": expires } : {} });
  }) as unknown as typeof fetch;
}
const deps = (f = fakeHost()) => ({ fetch: f, dnsLookup: publicDns });
function person(role = "owner"): PersonRow {
  const id = newPersonId(); const at = new Date().toISOString();
  return db.insert(people).values({ id, displayName: "Willow", role, avatarSeed: id, source: "hub", createdAt: at, updatedAt: at, hlc: nextHlc() }).returning().get() as PersonRow;
}
function cookie(p: PersonRow) {
  const token = `session-${p.id}`; const at = new Date().toISOString();
  db.insert(sessions).values({ id: `sess-${p.id}`, personId: p.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: at }).run();
  return { "content-type": "application/json", cookie: `session=${token}` };
}
beforeEach(() => { resetDb(); calls.length = 0; setHouseholdSettingValue("coding.enabled", true); __setMissingCodingPieceForTests(null); });

test("create verifies with one read-only call, stores the token encrypted and returns no token", async () => {
  const p = person();
  const made = await createGitConnection(p, { kind: "github", token: TOKEN }, deps(fakeHost("willow", 200, "2027-03-01T00:00:00Z")));
  expect(calls).toEqual([{ url: "https://api.github.com/user", auth: `Bearer ${TOKEN}` }]);
  expect(made).toMatchObject({ kind: "github", host: "github.com", account: "willow", status: "active", expires_at: "2027-03-01T00:00:00.000Z" });
  expect(made.id).toMatch(/^gitc-[a-z0-9]{6,}$/);
  const stored = db.select().from(gitConnections).get()!;
  expect(stored.tokenEncrypted).not.toContain(TOKEN); expect(stored.tokenEncrypted.length).toBeGreaterThan(20);
  expect(JSON.stringify(made)).not.toContain(TOKEN); expect(JSON.stringify(listGitConnections(p))).not.toContain(TOKEN);
  expect(gitCredentialFor(p.id, made.id)?.token).toBe(TOKEN);
  expect(gitCredentialFor(person().id, made.id)).toBeNull(); // another person cannot read it
});

test("a gitea host is checked at its own address and a private or plain-http host is refused", async () => {
  const p = person();
  const made = await createGitConnection(p, { kind: "gitea", host: "git.example.com", token: TOKEN }, deps());
  expect(calls[0]).toEqual({ url: "https://git.example.com/api/v1/user", auth: `token ${TOKEN}` }); expect(made.host).toBe("git.example.com");
  const privateDns = async () => ({ address: "192.168.1.5", family: 4 });
  expect(await createGitConnection(p, { kind: "gitea", host: "nas.example.com", token: TOKEN }, { fetch: fakeHost(), dnsLookup: privateDns }).catch((e) => e)).toBeInstanceOf(GitConnectionError);
  for (const host of ["http://git.example.com", "git.example.com/x", "", "a b"]) expect(await createGitConnection(p, { kind: "gitea", host, token: TOKEN }, deps()).catch((e) => e)).toBeInstanceOf(GitConnectionError);
  expect(listGitConnections(p)).toHaveLength(1);
});

test("a rejected token stores nothing and the error names the next step without the token", async () => {
  const p = person();
  const err = await createGitConnection(p, { kind: "github", token: TOKEN }, deps(fakeHost("x", 401))).catch((e) => e);
  expect(err).toBeInstanceOf(GitConnectionError); expect(err.message).toContain("Make a new token"); expect(err.message).not.toContain(TOKEN);
  expect(db.select().from(gitConnections).all()).toHaveLength(0);
});

test("status: expired is derived, failing shows after a host failure, revoked wipes the token and ends use", async () => {
  const p = person();
  const a = await createGitConnection(p, { kind: "github", token: TOKEN }, deps());
  db.update(gitConnections).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).run();
  expect(listGitConnections(p)[0]!.status).toBe("expired"); expect(gitCredentialFor(p.id, a.id)).toBeNull();
  db.update(gitConnections).set({ expiresAt: null }).run();
  markGitConnectionFailing(p.id, a.id);
  expect(listGitConnections(p)[0]!.status).toBe("failing"); expect(gitCredentialFor(p.id, a.id)).toBeNull();
  expect(revokeGitConnection(p.id, a.id)).toBe(true);
  const row = db.select().from(gitConnections).get()!;
  expect(listGitConnections(p)[0]!.status).toBe("revoked"); expect(row.tokenEncrypted).toBe(""); expect(row.revokedAt).toBeTruthy();
  expect(revokeGitConnection(person().id, a.id)).toBe(false);
});

test("access follows the Coding switch and the person's access; minors cannot connect yet", async () => {
  const p = person(); const child = person("child");
  setHouseholdSettingValue("coding.enabled", false);
  expect((await createGitConnection(p, { kind: "github", token: TOKEN }, deps()).catch((e) => e)).message).toContain("turned off");
  setHouseholdSettingValue("coding.enabled", true);
  expect(await createGitConnection(child, { kind: "github", token: TOKEN }, deps()).catch((e) => e)).toBeInstanceOf(GitConnectionError);
  expect(calls).toHaveLength(0);
});

test("routes: person lists and revokes; admin sees no names, revokes; no response or log carries the token", async () => {
  const owner = person("owner"); const adult = person("adult"); const other = person("adult");
  const log = spyOn(console, "log").mockImplementation(() => {}); const error = spyOn(console, "error").mockImplementation(() => {});
  const spies = [log, error];
  const realFetch = globalThis.fetch; globalThis.fetch = fakeHost("willow");
  let made: Awaited<ReturnType<typeof createGitConnection>>;
  try {
    // POST goes through the outbound guard's real DNS in this path; use the lib for creation and the routes for everything a person or admin reads or revokes.
    made = await createGitConnection(adult, { kind: "github", token: TOKEN }, deps());
  } finally { globalThis.fetch = realFetch; }
  const asAdult = cookie(adult); const asOwner = cookie(owner); const asOther = cookie(other);
  const get = (path: string, headers: Record<string, string>) => app.request(`http://localhost/api/settings/${path}`, { headers });
  const del = (path: string, headers: Record<string, string>) => app.request(`http://localhost/api/settings/${path}`, { method: "DELETE", headers });

  const mine = await get("git-connections", asAdult); const mineText = await mine.text();
  expect(mine.status).toBe(200); expect(mineText).not.toContain(TOKEN); expect(JSON.parse(mineText).connections[0]).toMatchObject({ id: made.id, account: "willow", host: "github.com" });
  expect(JSON.parse(await (await get("git-connections", asOther)).text()).connections).toEqual([]);

  const adminView = await get(`git-connections/people/${adult.id}`, asOwner); const adminText = await adminView.text();
  expect(adminView.status).toBe(200); expect(adminText).not.toContain(TOKEN);
  const adminRow = JSON.parse(adminText).connections[0];
  expect(adminRow).toEqual({ id: made.id, person_id: adult.id, kind: "github", status: "active", created_at: made.created_at, expires_at: null });
  expect(adminText).not.toContain("willow"); expect(adminText).not.toContain("github.com"); // rule 6a: no account, host or repository names
  expect(JSON.stringify(listGitConnectionsForAdmin(adult))).not.toContain("willow");
  expect((await get(`git-connections/people/${adult.id}`, asAdult)).status).toBe(403);

  expect((await del(`git-connections/${made.id}`, asOther)).status).toBe(404); // not theirs
  expect((await del(`git-connections/people/${adult.id}/${made.id}`, asAdult)).status).toBe(403);
  const adminRevoke = await del(`git-connections/people/${adult.id}/${made.id}`, asOwner);
  expect(adminRevoke.status).toBe(200); expect(listGitConnections(adult)[0]!.status).toBe("revoked");

  const second = await createGitConnection(adult, { kind: "github", token: TOKEN }, deps());
  expect((await del(`git-connections/${second.id}`, asAdult)).status).toBe(200); // the person revokes their own
  expect(listGitConnections(adult).every((c) => c.status === "revoked")).toBe(true);
  expect(db.select().from(gitConnections).all().every((r) => r.tokenEncrypted === "")).toBe(true);
  for (const spy of spies) { expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN); spy.mockRestore(); }
});

test("POST validates the body and refuses a person without Coding access with a plain message", async () => {
  const guest = person("guest"); const h = cookie(guest);
  const res = await app.request("http://localhost/api/settings/git-connections", { method: "POST", headers: h, body: JSON.stringify({ kind: "github", token: TOKEN }) });
  expect(res.status).toBe(400); const text = await res.text();
  expect(text).toContain("Coding"); expect(text).not.toContain(TOKEN);
  expect((await app.request("http://localhost/api/settings/git-connections", { method: "POST", headers: h, body: JSON.stringify({ kind: "svn", token: TOKEN }) })).status).toBe(400);
  expect(calls).toHaveLength(0);
});

test("the token is released only while the person is still admitted: disabled person, denied grant, Coding off or paused each end use", async () => {
  const p = person("adult"); const made = await createGitConnection(p, { kind: "github", token: TOKEN }, deps());
  expect(gitCredentialFor(p.id, made.id)?.token).toBe(TOKEN);
  const at = new Date().toISOString();
  db.insert(grants).values({ id: "grant-deny0001", person: p.id, action: "use:code", effect: "deny", grantedByPersonId: p.id, createdAt: at, updatedAt: at, hlc: nextHlc() }).run();
  invalidatePass(p.id); expect(gitCredentialFor(p.id, made.id)).toBeNull();
  db.delete(grants).where(eq(grants.id, "grant-deny0001")).run(); invalidatePass(p.id);
  expect(gitCredentialFor(p.id, made.id)?.token).toBe(TOKEN);
  setHouseholdSettingValue("coding.paused", true); expect(gitCredentialFor(p.id, made.id)).toBeNull(); setHouseholdSettingValue("coding.paused", false);
  setHouseholdSettingValue("coding.enabled", false); expect(gitCredentialFor(p.id, made.id)).toBeNull(); setHouseholdSettingValue("coding.enabled", true);
  db.update(people).set({ enabled: false }).where(eq(people.id, p.id)).run(); invalidatePass(p.id);
  expect(gitCredentialFor(p.id, made.id)).toBeNull();
});

test("revoking blanks the host, account and provenance, also when a person's connections are all revoked (delete, memorialize)", async () => {
  const p = person(); await createGitConnection(p, { kind: "gitea", host: "git.example.com", token: TOKEN }, deps(fakeHost("willow")));
  expect(revokeAllGitConnections(p.id)).toBe(1);
  const row = db.select().from(gitConnections).get()!;
  expect(row.tokenEncrypted).toBe(""); expect(JSON.stringify(row)).not.toContain("git.example.com"); expect(JSON.stringify(row)).not.toContain("willow");
  expect(row.provenance).not.toContain("token"); expect(row.lastCheckedAt).toBeNull();
});
