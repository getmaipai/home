// ROBOT-DEVICE-01 (bot/docs/dev/design-reachy-mini-2026-09-27.md section
// 10): "the add flow refuses to finish while the unit's published
// default SSH password stands and rotates it into the credentials
// center." This is that rotation, over a real SSH2 connection (the
// `ssh2` package, MIT): connects once with the vendor's own published
// default password, changes it via `chpasswd`'s own stdin-only input
// (never a command-line argument - CLAUDE.md > Credentials and secrets:
// "never pass a secret on a command line or in a process list"), and
// hands back the new password for the caller to store through
// lib/secrets.ts's own encrypted-at-rest treatment. Never logs either
// password.
import { randomBytes } from "node:crypto";
import { Client } from "ssh2";

export interface RotateRobotPasswordOptions {
  host: string;
  port?: number;
  username: string;
  currentPassword: string;
  /** Overridable for tests; a real robot's own default shell command. */
  chpasswdCommand?: string;
  connectTimeoutMs?: number;
  execTimeoutMs?: number;
}

export class RobotPasswordRotationError extends Error {}

// `@types/ssh2`'s declared ClientChannel 'close' signature is `() => void`,
// but the installed ssh2@1.17.0 runtime (lib/utils.js, ChannelCloseFilter)
// deliberately emits the exec exit code as this event's first argument
// ("Align more with node child processes, where the close event gets the
// same arguments as the exit event") - verified in that installed source,
// not just the stale type declaration, per CLAUDE.md's "a claim about what
// a library does is verified in the installed source and the line cited."
function execWithStdin(conn: Client, command: string, stdin: string, timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new RobotPasswordRotationError(`${command} timed out after ${timeoutMs}ms`)), timeoutMs);
    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return reject(err);
      }
      let stderr = "";
      stream.on("data", () => {}); // drain stdout; chpasswd has none on success
      stream.on("error", (streamErr: Error) => {
        clearTimeout(timer);
        reject(streamErr);
      });
      stream.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      stream.on("close", (code: number) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });
      stream.end(`${stdin}\n`);
    });
  });
}

/**
 * Rotates a freshly-paired robot's SSH password from its vendor default
 * to a freshly generated one. Connects with `currentPassword` exactly
 * once; if that connection fails, the password may already be rotated
 * (a retried pairing) or genuinely wrong - either way this throws and
 * changes nothing on the robot.
 */
export async function rotateRobotPassword(opts: RotateRobotPasswordOptions): Promise<{ newPassword: string }> {
  const newPassword = randomBytes(24).toString("base64url");
  const command = opts.chpasswdCommand ?? "sudo chpasswd";

  const conn = new Client();
  try {
    await new Promise<void>((resolve, reject) => {
      conn
        .on("ready", () => resolve())
        .on("error", (err: Error) => reject(err))
        .connect({
          host: opts.host,
          port: opts.port ?? 22,
          username: opts.username,
          password: opts.currentPassword,
          readyTimeout: opts.connectTimeoutMs ?? 10_000,
        });
    });

    const { code, stderr } = await execWithStdin(conn, command, `${opts.username}:${newPassword}`, opts.execTimeoutMs ?? 10_000);
    if (code !== 0) {
      throw new RobotPasswordRotationError(`${command} exited ${code}: ${stderr.trim() || "no output"}`);
    }
  } finally {
    conn.end();
  }

  return { newPassword };
}
