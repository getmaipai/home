import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  __setStackServiceRunnerForTests,
  installRoot,
  HOME_STACK_PORT,
  startLocalStackService,
  stopLocalStackService,
  type StackServiceCommand,
} from "@/lib/localStackService";

afterEach(() => {
  __setStackServiceRunnerForTests(null);
  delete process.env.MAIPAI_INSTALL_ROOT;
  delete process.env.MAIPAI_STACK_BINARY;
  delete process.env.MAIPAI_STACK_DATA_DIR;
  delete process.env.MAIPAI_STACK_BUN_BIN;
  delete process.env.MAIPAI_STACK_PORT;
});

describe("local Stack service commands", () => {
  test("stop uses the installed Stack service CLI and install-service environment", () => {
    const calls: Array<{ binary: string; command: StackServiceCommand; env: NodeJS.ProcessEnv }> = [];
    process.env.MAIPAI_INSTALL_ROOT = "/tmp/home-install";
    __setStackServiceRunnerForTests((binary, command, env) => calls.push({ binary, command, env }));
    stopLocalStackService();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("stop");
    expect(calls[0]!.binary).toContain("maipai-stack-");
    expect(calls[0]!.env).toMatchObject({
      STACK_DATA_DIR: "/tmp/home-install/stack/data",
      PORT: String(HOME_STACK_PORT),
      STACK_BUN_BIN: "/tmp/home-install/.bun/bin/bun",
    });
  });

  test("starting this computer invokes the Stack start verb", () => {
    const commands: StackServiceCommand[] = [];
    process.env.MAIPAI_STACK_BINARY = "/tmp/maipai-stack";
    __setStackServiceRunnerForTests((_binary, command) => commands.push(command));
    startLocalStackService();
    expect(commands).toEqual(["start"]);
  });

  // 2026-10-17: a test that reached the default runner executed the installed production Stack with stop/start.
  test("the real runner refuses the installed Stack binary under a test run and never spawns it", () => {
    delete process.env.MAIPAI_STACK_BINARY;
    delete process.env.MAIPAI_INSTALL_ROOT;
    expect(installRoot()).toBe("/usr/local/maipai-home");
    for (const action of [stopLocalStackService, startLocalStackService]) {
      expect(action).toThrow("Refusing to run");
    }
  });

  test("a stub binary under the temp directory still runs, so the real runner stays testable", () => {
    process.env.MAIPAI_STACK_BINARY = "/nonexistent-never-spawned";
    expect(() => stopLocalStackService()).toThrow("Refusing to run");
    process.env.MAIPAI_STACK_BINARY = `${tmpdir()}/maipai-no-such-stub`;
    expect(() => stopLocalStackService()).toThrow(/ENOENT|no such file/i);
  });
});
