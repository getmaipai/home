import { describe, expect, test, beforeEach } from "bun:test";
import { app } from "@/app";
import { resetDb } from "./reset-db";

// A route may be intentionally writable before a household session exists,
// or may authenticate with a protocol-specific proof. Keep each exception
// exact and explain its public contract here.
const WRITE_ROUTE_ALLOWLIST: Array<{ method: string; path: string; reason: string }> = [
  { method: "POST", path: "/api/auth/setup", reason: "setup wizard creates the first owner before sign-in" },
  { method: "POST", path: "/api/auth/select", reason: "profile selection uses its credential-free child setup flow" },
  { method: "POST", path: "/api/auth/verify-secret", reason: "sign-in verifies the submitted secret and issues a session" },
  { method: "POST", path: "/api/auth/passkeys/register/options", reason: "passkey registration starts a WebAuthn ceremony" },
  { method: "POST", path: "/api/auth/passkeys/register/verify", reason: "passkey registration completes a WebAuthn ceremony" },
  { method: "POST", path: "/api/auth/passkeys/authenticate/options", reason: "passkey sign-in starts a WebAuthn ceremony" },
  { method: "POST", path: "/api/auth/passkeys/authenticate/verify", reason: "passkey sign-in completes a WebAuthn ceremony" },
  { method: "POST", path: "/api/auth/devices/redeem", reason: "device token redemption authenticates with its bearer token" },
  { method: "POST", path: "/api/auth/quick-connect/code", reason: "Quick Connect starts device pairing before a household session exists" },
  { method: "POST", path: "/api/auth/quick-connect/approve", reason: "Quick Connect approval is an explicit pairing-code exchange" },
  { method: "POST", path: "/api/auth/totp/challenge", reason: "TOTP challenge completes a pending primary-factor sign-in" },
  { method: "POST", path: "/api/client-errors", reason: "client error reporting is a bounded anonymous diagnostic intake" },
];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REFUSAL_STATUSES = new Set([401, 403, 404]);

function routePath(path: string): string {
  // Hono stores mounted routes with their mount prefix already applied and
  // uses :name and * for parameters. Supply inert values to reach handlers.
  return path
    .replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
      if (/token|secret|code|key|id/i.test(name)) return "coverage-probe-id";
      return "coverage-probe";
    })
    .replace(/\*/g, "coverage-probe");
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

beforeEach(() => resetDb());

describe("write route unauthenticated coverage", () => {
  test("every registered write route refuses unauthenticated JSON, unless explicitly listed", async () => {
    const writeRoutes = [...new Map(app.routes
      .filter((route) => WRITE_METHODS.has(route.method.toUpperCase()))
      .map((route) => {
        const normalized = { method: route.method.toUpperCase(), path: route.path };
        return [routeKey(normalized.method, normalized.path), normalized] as const;
      })).values()];
    const actualKeys = new Set(writeRoutes.map(({ method, path }) => routeKey(method, path)));

    const staleAllowlistEntries = WRITE_ROUTE_ALLOWLIST.filter(({ method, path, reason }) =>
      !reason.trim() || !actualKeys.has(routeKey(method, path))
    );
    expect(staleAllowlistEntries, "allowlist entries must name a registered route and include a reason").toEqual([]);

    const allowed = new Set(WRITE_ROUTE_ALLOWLIST.map(({ method, path }) => routeKey(method, path)));
    const violations: string[] = [];

    for (const { method, path } of writeRoutes) {
      if (allowed.has(routeKey(method, path))) continue;
      const response = await app.request(`http://localhost${routePath(path)}`, {
        method,
        headers: { host: "localhost", "content-type": "application/json" },
        body: "{}",
      });
      if (!REFUSAL_STATUSES.has(response.status)) {
        violations.push(`${method} ${path} responded ${response.status}`);
      }
    }

    expect(violations, "write routes must refuse anonymous writes or have an explained allowlist entry").toEqual([]);
  });
});
