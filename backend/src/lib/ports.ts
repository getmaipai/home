// The two ports the installed app uses, in one place. The installer
// (scripts/install.sh) picks them, writes them into the Home service as
// PORT and MAIPAI_STACK_PORT, and every check here reads them back, so a
// moved port is moved everywhere. The defaults are unchanged.
export const DEFAULT_HOME_PORT = 3000;
export const DEFAULT_STACK_PORT = 8770;

function validPort(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** Home's own port: PORT from the service, else 3000. */
export function homePort(env: NodeJS.ProcessEnv = process.env): number {
  return validPort(env.PORT) ?? DEFAULT_HOME_PORT;
}

/** The local Stack's port: MAIPAI_STACK_PORT from the service, else 8770. */
export function stackPort(env: NodeJS.ProcessEnv = process.env): number {
  return validPort(env.MAIPAI_STACK_PORT) ?? DEFAULT_STACK_PORT;
}

export function defaultStackBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `http://127.0.0.1:${stackPort(env)}`;
}
