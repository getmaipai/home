// CODE-AGENT-01 (slice three): the secret check in front of Push and pull request, run with gitleaks on the hub's clean copy of the session branch
// (lib/gitHost.ts `beforePush`). It scans the branch's history with `--redact`, so a finding's value never reaches Home's memory, a log or an error; only
// the file path and line are read from the report. It fails closed: a missing program, a failed run or an unreadable report is a refusal, never a pass.
// A missing program is also shown as a Repairs row (source `coding`), the existing surface for "something Home needs is not installed".
// Exit codes (gitleaks): 0 clean, 1 findings (we ask for that with --exit-code 1), anything else is an error.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { CodingSessionError } from "@/lib/codingSessions";
import type { SecretFinding, SecretScanner } from "@/lib/codingShare";

export interface GitleaksRun { code: number; stderr: string }
/** The one place the program is run; tests pass a fake. `missing` means the program could not be started. */
export type GitleaksRunner = (args: string[], cwd: string) => Promise<GitleaksRun | "missing">;

const ISSUE = { source: "coding", key: "gitleaks_missing" } as const;
export const GITLEAKS_MISSING_LINE = "The secret check (gitleaks) is not installed, so Home will not push or open a pull request. Ask an admin to install it from the Coding page in Settings, then try again.";

export const realGitleaksRunner: GitleaksRunner = async (args, cwd) => {
  const bin = process.env.MAIPAI_GITLEAKS_BIN || Bun.which("gitleaks");
  if (!bin) return "missing";
  try {
    const child = Bun.spawn([bin, ...args], { cwd, stdout: "ignore", stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: cwd } });
    const timer = setTimeout(() => child.kill(), 120_000);
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    clearTimeout(timer);
    return { code, stderr: stderr.slice(-300) };
  } catch { return "missing"; }
};

/** Findings from a gitleaks JSON report: the path and the start line only. Anything else in the report (the match, the secret, the commit) is dropped here. */
export function findingsFromReport(text: string): SecretFinding[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error("report is not a list");
  return parsed.map((row) => {
    const r = row as { File?: unknown; StartLine?: unknown };
    return { path: typeof r.File === "string" ? r.File.slice(0, 300) : "unknown", line: typeof r.StartLine === "number" && r.StartLine >= 1 ? Math.floor(r.StartLine) : 1 };
  });
}

export function createGitleaksScanner(run: GitleaksRunner = realGitleaksRunner): SecretScanner {
  return async ({ dir, ref }) => {
    const work = await mkdtemp(path.join(tmpdir(), "maipai-gitleaks-"));
    const report = path.join(work, "report.json");
    try {
      // Scans the commits reachable from the branch, in the clean copy only; never the agent's workspace.
      const out = await run(["git", "--no-banner", "--redact", "--exit-code", "1", "--report-format", "json", "--report-path", report, "--log-opts", ref, dir], dir);
      if (out === "missing") {
        await raiseIssue({ source: ISSUE.source, key: ISSUE.key, severity: "warning", title: "The secret check for Code sessions is not installed", detail: "Home checks a session's changes with gitleaks before it pushes. Install gitleaks on this computer, then push again." }).catch(() => undefined);
        throw new CodingSessionError("not_allowed", GITLEAKS_MISSING_LINE);
      }
      try { await resolveIssue(ISSUE.source, ISSUE.key, { suppressNotification: true }); } catch { /* the row closes on the next good run */ }
      if (out.code === 0) return [];
      if (out.code !== 1) throw new CodingSessionError("not_allowed", "The secret check could not finish, so Home did not push. Try again; if it repeats, check that gitleaks is up to date.");
      try { return findingsFromReport(await readFile(report, "utf8")); }
      catch { throw new CodingSessionError("not_allowed", "The secret check found something but its report could not be read, so Home did not push. Try again."); }
    } finally { await rm(work, { recursive: true, force: true }); }
  };
}
