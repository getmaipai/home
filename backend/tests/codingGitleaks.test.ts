// CODE-AGENT-01 slice three: the gitleaks scanner. A fake runner stands in for the program; the opt-in test at the bottom runs the real one
// (MAIPAI_REAL_GITLEAKS=1, gitleaks installed).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { createGitleaksScanner, findingsFromReport, type GitleaksRunner } from "@/lib/codingGitleaks";
import { listIssues } from "@/lib/issues";
import { CodingSessionError } from "@/lib/codingSessions";
import { startRig } from "./codingRig";

let rig: ReturnType<typeof startRig>;
beforeEach(() => { rig = startRig(); }); afterEach(() => rig.restore());
const scan = (run: GitleaksRunner) => createGitleaksScanner(run)({ dir: "/tmp/clean-copy", ref: "refs/heads/maipai/fix" });
const reportPath = (args: string[]) => args[args.indexOf("--report-path") + 1]!;

describe("the gitleaks scanner", () => {
  test("it asks for a redacted JSON report of the branch and returns nothing on a clean exit", async () => {
    let seen: string[] = [];
    expect(await scan(async (args) => { seen = args; return { code: 0, stderr: "" }; })).toEqual([]);
    expect(seen).toEqual(expect.arrayContaining(["git", "--redact", "--exit-code", "1", "--report-format", "json", "--log-opts", "refs/heads/maipai/fix"]));
  });
  test("findings keep only the path and the line; the match and the secret are dropped", async () => {
    const found = await scan(async (args) => {
      writeFileSync(reportPath(args), JSON.stringify([{ File: "config/app.env", StartLine: 7, Match: "TOKEN=abc", Secret: "supersecretvalue", Commit: "deadbeef" }]));
      return { code: 1, stderr: "" };
    });
    expect(found).toEqual([{ path: "config/app.env", line: 7 }]); expect(JSON.stringify(found)).not.toContain("supersecret");
  });
  test("a missing program fails closed with a plain line and a Repairs row, which closes on the next good run", async () => {
    const err = await scan(async () => "missing").then(() => null, (e) => e as Error);
    expect(err).toBeInstanceOf(CodingSessionError); expect(err!.message).toContain("gitleaks) is not installed");
    expect(listIssues().some((i) => i.source === "coding" && i.key === "gitleaks_missing")).toBe(true);
    await scan(async () => ({ code: 0, stderr: "" }));
    expect(listIssues().some((i) => i.source === "coding" && i.key === "gitleaks_missing")).toBe(false);
  });
  test("an error exit and an unreadable report both refuse", async () => {
    expect((await scan(async () => ({ code: 2, stderr: "boom" })).then(() => null, (e) => e as Error))!.message).toContain("could not finish");
    expect((await scan(async (args) => { writeFileSync(reportPath(args), "not json"); return { code: 1, stderr: "" }; }).then(() => null, (e) => e as Error))!.message).toContain("report could not be read");
  });
  test("a report that is not a list is rejected", () => { expect(() => findingsFromReport("{}")).toThrow(); });
});

describe.skipIf(process.env.MAIPAI_REAL_GITLEAKS !== "1")("the real gitleaks (opt-in)", () => {
  test("a planted key in a commit is found with its path and line, and a clean branch passes", async () => {
    const { execFileSync } = await import("node:child_process"); const { mkdtempSync, rmSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "gl-real-"));
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env: { PATH: process.env.PATH ?? "", HOME: dir, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "W", GIT_AUTHOR_EMAIL: "w@example.com", GIT_COMMITTER_NAME: "W", GIT_COMMITTER_EMAIL: "w@example.com" } });
    try {
      git("init", "-q", "-b", "main"); writeFileSync(join(dir, "ok.txt"), "hello\n"); git("add", "-A"); git("commit", "-qm", "clean");
      const real = createGitleaksScanner();
      expect(await real({ dir, ref: "refs/heads/main" })).toEqual([]);
      writeFileSync(join(dir, "creds.env"), `AWS_ACCESS_KEY_ID=${"AK" + "IA"}IOSFODNN7ABCDEFG\nAWS_SECRET_ACCESS_KEY=${"wJalrXUtnFEMI/K7MDENG"}/bPxRfiCYzZ1a2b3c4d\n`); git("add", "-A"); git("commit", "-qm", "oops");
      const found = await real({ dir, ref: "refs/heads/main" });
      expect(found.some((f) => f.path === "creds.env")).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
