// A minimal, real in-process SSH2 server for testing rotateRobotPassword()
// without Docker or any real host: no container runtime was available in
// this environment, and `ssh2` (already the client dependency) ships a
// full server implementation, so this is a genuine SSH2 protocol round
// trip on loopback, not a mock of the client's own calls.
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Server, utils } from "ssh2";

export interface FakeSshdOptions {
  username: string;
  password: string;
  /** The exact command the client is expected to exec; anything else is refused. */
  command?: string;
  /** Called with the exact stdin the client sent; returns the exit code and any stderr. */
  onCommand: (stdin: string) => { code: number; stderr?: string };
}

export interface FakeSshd {
  port: number;
  close: () => Promise<void>;
}

function safeEqual(input: string, allowed: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(allowed);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ECDSA P-256, not Ed25519: ssh2 1.17.0's Ed25519 key writer strips leading
// zero bytes from the 32-byte public key, so about 1 in 256 of the Ed25519
// keys it generates cannot be loaded back ("Malformed OpenSSH private key").
// Its ECDSA writer has no such step. The host key type is not what these
// tests exercise; the client accepts either.
export function generateFakeSshHostKey(): { private: string; public: string } {
  return utils.generateKeyPairSync("ecdsa", { bits: 256 });
}

export async function startFakeSshd(opts: FakeSshdOptions): Promise<FakeSshd> {
  const hostKey = generateFakeSshHostKey();
  const expectedCommand = opts.command ?? "sudo chpasswd";

  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client
      .on("authentication", (ctx) => {
        if (ctx.method !== "password") return ctx.reject(["password"]);
        if (!safeEqual(ctx.username, opts.username) || !safeEqual(ctx.password, opts.password)) {
          return ctx.reject(["password"]);
        }
        ctx.accept();
      })
      .on("ready", () => {
        client.on("session", (accept) => {
          const session = accept();
          session.once("exec", (accept, _reject, info) => {
            const stream = accept();
            if (info.command !== expectedCommand) {
              stream.stderr.write(`unexpected command: ${info.command}\n`);
              stream.exit(1);
              stream.end();
              return;
            }
            let stdin = "";
            stream.on("data", (chunk: Buffer) => {
              stdin += chunk.toString();
            });
            stream.on("end", () => {
              const result = opts.onCommand(stdin.trim());
              if (result.stderr) stream.stderr.write(result.stderr);
              stream.exit(result.code);
              stream.end();
            });
          });
        });
      })
      .on("error", () => {}); // a client that disconnects mid-handshake is expected in the refusal tests
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
