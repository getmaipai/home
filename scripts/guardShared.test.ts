import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// SINGLE-WRITER-01: the PreToolUse guardrail denies a session's push to main and its restarts of shared services, and lets the rest through.
const hook = join(import.meta.dir, "hooks", "guard-shared.sh");
const decide = (command: string) => {
  const r = Bun.spawnSync(["bash", hook], { stdin: Buffer.from(JSON.stringify({ tool_name: "Bash", tool_input: { command } })), stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, err: r.stderr.toString() };
};

describe("guard-shared.sh", () => {
  for (const command of [
    "git push origin HEAD:main",
    "git -C /tmp/x push origin main",
    "cd /tmp/w && git push origin abc123:refs/heads/main",
    "git push --force origin +HEAD:main",
    "launchctl bootout gui/501/com.maipai.stack",
    "sudo -n launchctl kickstart -k system/com.maipai.home",
    "bash scripts/pipeline.sh stack off",
    "sudo -n /usr/local/libexec/maipai-promote abc1234",
    "sudo -n maipai-install v0.2.200",
    "sudo -n /usr/local/libexec/maipai-promote --rollback",
    "MAIPAI_OWNER_APPROVED=1 sudo -n /usr/local/libexec/maipai-promote abc1234",
    "MAIPAI_OWNER_APPROVED=1 sudo -n maipai-install main",
    "MAIPAI_OWNER_APPROVED=1 sudo -n maipai-install v0.2.200 && launchctl kickstart -k gui/501/com.maipai.stack",
    "MAIPAI_OWNER_APPROVED=1 bash scripts/pipeline.sh stack off",
    "MAIPAI_OWNER_APPROVED=1 git push origin HEAD:main",
  ]) test(`denies: ${command}`, () => {
    const r = decide(command);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.err).decision).toBe("deny");
    expect(JSON.parse(r.err).reason).toContain("MAIPAI_OWNER_APPROVED=1");
  });
  for (const command of [
    "git push origin HEAD:refs/heads/wt/clever-yak-x",
    "git push --force-with-lease -u origin HEAD:refs/heads/wt/maintenance",
    "git log origin/main",
    "launchctl list | grep maipai",
    "launchctl print gui/501/com.maipai.stack",
    "bash scripts/pipeline.sh stack status",
    "bash scripts/ship.sh status",
    "bash scripts/land.sh --express",
    "MAIPAI_OWNER_APPROVED=1 sudo -n /usr/local/libexec/maipai-promote --rollback",
    "MAIPAI_OWNER_APPROVED=1 sudo -n maipai-install v0.2.200",
    "bash scripts/rush-ship.sh --owner-asked",
  ]) test(`allows: ${command}`, () => {
    expect(decide(command).code).toBe(0);
  });
});
