// CODE-AGENT-01 (slice four): opening a pull request for a Code session, through the person's own git connection and the host's API (GitHub, or the household's
// Gitea). It is always the person's click (the brake's `pull_request` effect always asks; the route is that click and needs `confirm`). It runs the push first, which
// runs the secret check on the hub's clean copy (lib/codingShare.ts, gitleaks), so a missing or failing scan, a refused push or a refused token stops it before any
// host call: it fails closed. Only the session's own branch is the head; the base is the session's base branch. The token reaches the host only in the request header,
// over the outbound guard (https, public address, no redirects), and never appears in an error, a log or a record.
import { eq } from "drizzle-orm";
import { assertNotPrivateHost, guardedFetch, SsrfBlockedError, type DnsLookup } from "@maipai/core/src/ssrfGuard";
import { db } from "@/db";
import { codingSessions } from "@/db/schema";
import { gitCredentialFor, markGitConnectionFailing } from "@/lib/gitConnections";
import { HOME_USER_AGENT } from "@/lib/outbound";
import { CodingSessionError, getSessionRow, requireCodingAccess } from "@/lib/codingSessions";
import { pushCodingSession } from "@/lib/codingShare";
import { recordCodingEvent } from "@/lib/codingEvents";
import { redactCredentials } from "@/lib/codingRedact";
import { appendLogLine } from "@/lib/log";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";

export interface PullRequestDeps { fetch?: typeof fetch; dnsLookup?: DnsLookup }
let testDeps: PullRequestDeps = {};
export function __setPullRequestDepsForTests(deps: PullRequestDeps | null): void { testDeps = deps ?? {}; }

export interface PullRequestWire { url: string; number: number; draft: boolean }
const BODY = "Opened from a MaiPai Code session. Review the changes before you merge.";

export async function createCodingPullRequest(person: PersonRow, sessionId: string, input: { confirm: boolean; title?: string; draft?: boolean }): Promise<PullRequestWire> {
  requireCodingAccess(person); // an existing pull request is shown only to someone who may still use Code
  const existing = getSessionRow(person.id, sessionId)?.pullRequest;
  if (existing) return existing; // one pull request per session; opening again shows the same one
  // Access, confirmation, repository and token checks, the clean copy, the secret check and the push all happen here, in that order, and any refusal stops the call.
  await pushCodingSession(person, sessionId, input.confirm);
  const row = getSessionRow(person.id, sessionId)!;
  const repo = row.repo as { kind: "github" | "gitea"; connection_id: string; full_name: string; base_branch: string; work_branch: string };
  const credential = gitCredentialFor(person.id, repo.connection_id);
  if (!credential) throw new CodingSessionError("bad_input", "The git connection for this session is not available. Reconnect it in Settings, Coding, then try again.");
  const [owner, name] = repo.full_name.split("/");
  const title = redactCredentials((input.title ?? row.title).trim().slice(0, 200) || "Code session changes").text;
  const draft = input.draft ?? true; // conservative: a draft until the person marks it ready on the host
  const url = new URL(credential.kind === "github" ? `https://api.github.com/repos/${owner}/${name}/pulls` : `https://${credential.host}/api/v1/repos/${owner}/${name}/pulls`);
  const headers: Record<string, string> = { "user-agent": HOME_USER_AGENT, accept: credential.kind === "github" ? "application/vnd.github+json" : "application/json", "content-type": "application/json",
    authorization: credential.kind === "github" ? `Bearer ${credential.token}` : `token ${credential.token}` };
  const payload = credential.kind === "github" ? { title, head: repo.work_branch, base: repo.base_branch, body: BODY, draft } : { title: draft ? `WIP: ${title}` : title, head: repo.work_branch, base: repo.base_branch, body: BODY };
  let res: Response;
  try {
    await assertNotPrivateHost(url.hostname, testDeps.dnsLookup);
    const init = { method: "POST", redirect: "manual" as const, headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) };
    res = testDeps.fetch ? await testDeps.fetch(url, init) : await guardedFetch(url, { ...init, maxRedirects: 0 }, testDeps.dnsLookup);
  } catch (e) {
    if (e instanceof SsrfBlockedError) throw new CodingSessionError("bad_input", "That address is not a public https host Home can reach. Check the connection's host in Settings, Coding.");
    throw new CodingSessionError("bad_input", "Home could not reach the git host to open the pull request. Check your connection and try again; the branch is already pushed.");
  }
  if (res.status === 401 || res.status === 403) { await res.body?.cancel().catch(() => undefined); markGitConnectionFailing(person.id, credential.id); throw new CodingSessionError("bad_input", "The host refused to open the pull request. The token may have expired or may not allow pull requests: replace the connection in Settings, Coding, then try again."); }
  if (res.status === 404) { await res.body?.cancel().catch(() => undefined); throw new CodingSessionError("bad_input", "The host does not have that repository, or the token cannot see it. Check the repository and your token, then try again."); }
  if (res.status === 409 || res.status === 422) { await res.body?.cancel().catch(() => undefined); throw new CodingSessionError("bad_input", "The host did not open a pull request. One may already exist for this branch, or the branch has no new changes. Check the repository on the host."); }
  if (res.status !== 201) { await res.body?.cancel().catch(() => undefined); throw new CodingSessionError("bad_input", "The host did not accept the pull request. Try again in a moment; the branch is already pushed."); }
  let made: { html_url?: unknown; number?: unknown; draft?: unknown };
  try { made = await res.json() as typeof made; } catch { made = {}; }
  // The address is the host's word: it must be https on the connection's own host, or it is not shown.
  const link = typeof made.html_url === "string" ? safeLink(made.html_url, credential.kind === "github" ? "github.com" : credential.host) : null;
  if (!link || typeof made.number !== "number" || made.number < 1) throw new CodingSessionError("bad_input", "The host answered, but not with a pull request Home can show. Check the repository on the host.");
  const pr: PullRequestWire = { url: link, number: Math.floor(made.number), draft: made.draft === true || (credential.kind === "gitea" && draft) };
  db.update(codingSessions).set({ pullRequest: pr, updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(codingSessions.id, sessionId)).run();
  recordCodingEvent({ sessionId, personId: person.id, kind: "pull_request", detail: { url: pr.url } });
  appendLogLine(`coding pull_request_opened session=${sessionId} person=${person.id}`);
  return pr;
}

function safeLink(value: string, host: string): string | null {
  try { const u = new URL(value); return u.protocol === "https:" && u.hostname.toLowerCase() === host.toLowerCase() && !u.username && !u.password ? u.href : null; } catch { return null; }
}
