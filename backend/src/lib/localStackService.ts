import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const HOME_STACK_PORT = 8770;

export type StackServiceCommand = "start" | "stop";
export type StackServiceRunner = (binary: string, command: StackServiceCommand, env: NodeJS.ProcessEnv) => void;

function installRoot(): string {
  if (process.env.MAIPAI_INSTALL_ROOT) return process.env.MAIPAI_INSTALL_ROOT;
  return process.platform === "darwin" ? "/usr/local/maipai-home" : "/opt/maipai-home";
}

function binaryPath(): string {
  if (process.env.MAIPAI_STACK_BINARY) return process.env.MAIPAI_STACK_BINARY;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;
  const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform;
  return join(installRoot(), "stack", `maipai-stack-${os}-${arch}`);
}

function runStackServiceCommand(binary: string, command: StackServiceCommand, env: NodeJS.ProcessEnv): void {
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
    PORT: process.env.MAIPAI_STACK_PORT ?? String(HOME_STACK_PORT),
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
