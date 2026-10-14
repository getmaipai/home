import { getConnInfo } from "hono/bun";
import type { Context, MiddlewareHandler } from "hono";
import { db } from "@/db";
import { people } from "@/db/schema";

type SetupServer = {
  port?: number;
  requestIP?: (request: Request) => { address?: string | null } | null;
};

export function setupIsComplete(): boolean {
  return Boolean(db.select({ id: people.id }).from(people).limit(1).get());
}

function localSetupUrl(c: Context): string {
  const env = c.env as { server?: SetupServer; port?: number } | undefined;
  const server = env?.server ?? env;
  const port = typeof server?.port === "number" ? server.port : 3000;
  return `http://localhost:${port}`;
}

function hasForwardingHeader(headers: Headers): boolean {
  for (const name of headers.keys()) {
    const lower = name.toLowerCase();
    if (
      lower === "forwarded" ||
      lower === "x-real-ip" ||
      lower === "cf-connecting-ip" ||
      lower.startsWith("x-forwarded-")
    ) {
      return true;
    }
  }
  return false;
}

export function isLocalHost(host: string | undefined): boolean {
  return !!host && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}

export function isLoopbackPeer(c: Context): boolean {
  try {
    const address = getConnInfo(c).remote.address;
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  } catch {
    return false;
  }
}

export function setupLocalRefusal(c: Context, reason: "peer" | "forwarded" | "host"): Response {
  const url = localSetupUrl(c);
  const detail = reason === "peer"
    ? "Setup is only available on the computer running MaiPai Home."
    : reason === "forwarded"
      ? "Setup requests cannot pass through a forwarding proxy."
      : "Setup requires the localhost address.";
  return c.json({ error: `${detail} Open ${url} in a browser on that computer.` }, 403);
}

/** Protects first-run setup APIs using the socket peer, request headers, and Host. */
export const setupLocalOnly: MiddlewareHandler = async (c, next) => {
  // Preserve the existing post-setup API responses, including auth/setup's 409.
  if (setupIsComplete()) return next();

  if (!isLoopbackPeer(c)) return setupLocalRefusal(c, "peer");
  if (hasForwardingHeader(c.req.raw.headers)) return setupLocalRefusal(c, "forwarded");
  if (!isLocalHost(c.req.header("host"))) return setupLocalRefusal(c, "host");
  await next();
};
