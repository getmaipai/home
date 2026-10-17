import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { DEFAULT_STACK_PORT, stackPort } from "./ports";

export const HOME_STACK_PORT = DEFAULT_STACK_PORT;

export type StackServiceCommand = "start" | "stop";
export type StackServiceRunner = (binary: string, command: StackServiceCommand, env: NodeJS.ProcessEnv) => void;

export function installRoot(): string {
  if (process.env.MAIPAI_INSTALL_ROOT) return process.env.MAIPAI_INSTALL_ROOT;
  return process.platform === "darwin" ? "/usr/local/maipai-home" : "/opt/maipai-home";
}

function binaryPath(): string {
  if (process.env.MAIPAI_STACK_BINARY) return process.env.MAIPAI_STACK_BINARY;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;
  const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform;
  return join(installRoot(), "stack", `maipai-stack-${os}-${arch}`);
}

// 2026-10-17 04:31, 05:20, 05:30, 05:39: every `bun test` run in Home
// executed the installed production Stack binary with `stop` then
// `start` (remoteStackSettings.test.ts flips engines.stack.where without
// a runner), which boots the real com.maipai.stack LaunchAgent out; the
// start raced launchd's cleanup (error 37) and left it unloaded. Under
// a test run the real runner now refuses any binary that is not inside
// the OS temp directory, so no test can reach the installed Stack.
function underTempDir(path: string): boolean {
  const root = realpathSync(tmpdir());
  const resolved = resolve(path);
  return resolved === root || resolved.startsWith(root + sep) || resolved.startsWith(tmpdir() + sep);
}

function runStackServiceCommand(binary: string, command: StackServiceCommand, env: NodeJS.ProcessEnv): void {
  if (process.env.NODE_ENV === "test" && !underTempDir(binary)) {
    throw new Error(`Refusing to run "${binary} ${command}" from a test: it would control the installed MaiPai Stack. Set MAIPAI_STACK_BINARY to a stub under the temp directory or install a runner with __setStackServiceRunnerForTests.`);
  }
  const result = spawnSync(binary, [command], { encoding: "utf8", env, timeout: 20_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `MaiPai Stack ${command} command failed.`);
}

let runner: StackServiceRunner = runStackServiceCommand;

function serviceEnv(): NodeJS.ProcessEnv {
  const root = installRoot();
  return {
    ...process.env,
    STACK_DATA_DIR: process.env.MAIPAI_STACK_DATA_DIR ?? join(root, "stack", "data"),
    PORT: String(stackPort()),
    STACK_BUN_BIN: process.env.MAIPAI_STACK_BUN_BIN ?? join(root, ".bun", "bin", "bun"),
  };
}

function run(command: StackServiceCommand): void {
  const binary = binaryPath();
  if (!existsSync(binary) && !process.env.MAIPAI_STACK_BINARY && process.env.NODE_ENV !== "test") {
    throw new Error(`MaiPai Stack service binary is missing at ${binary}.`);
  }
  runner(binary, command, serviceEnv());
}

export function stopLocalStackService(): void { run("stop"); }
export function startLocalStackService(): void { run("start"); }

export function __setStackServiceRunnerForTests(value: StackServiceRunner | null): void {
  runner = value ?? runStackServiceCommand;
}
