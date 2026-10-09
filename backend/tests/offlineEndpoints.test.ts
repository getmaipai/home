import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DEFAULT_ON_PUBLIC_READS, declaredEndpointText } from "@/lib/privacy";

// OFFLINE-TEST-01 (b): every outbound endpoint the hub contacts is declared
// once, in a package's manifest `data_sources` or in lib/privacy.ts
// (platformConnections, or DEFAULT_ON_PUBLIC_READS for a named default-on
// public read), and this test fails on a host the source names that no
// declaration covers. The runtime half (a hub booted with egress denied)
// is offlineStartup.test.ts.

const BACKEND = join(import.meta.dir, "..");

/** Hosts that appear in source but are not a connection the hub makes:
 * documentation and schema namespaces, reserved example names, loopback and
 * the household's own LAN. Each needs a reason; a real endpoint never goes
 * here, it goes in a declaration. */
const NOT_AN_ENDPOINT: Record<string, string> = {
  "127.0.0.1": "loopback",
  localhost: "loopback",
  "keepachangelog.com": "changelog format link in a doc comment",
  "json-schema.org": "JSON Schema namespace URI",
  "opds-spec.org": "OPDS namespace URI",
  "example.org": "reserved example name",
  "example.net": "reserved example name",
  "hub.example.com": "reserved example name",
  "home.invalid": "reserved invalid name",
  "homeassistant.local": "the household's own Home Assistant on its LAN",
  "192.168.1.50": "placeholder LAN address in a hint",
  "988lifeline.org": "a help link shown to a person, never fetched",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "tests" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|json)$/.test(name) && !/(_test|\.test)\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const declaredText = declaredEndpointText;

/** Hosts the platform declares by code rather than by prose in a row. */
function sourceHosts(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const files = [...walk(join(BACKEND, "src")), ...walk(join(BACKEND, "packages"))];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9])/g)) {
      const host = match[1]!.toLowerCase();
      found.set(host, [...(found.get(host) ?? []), relative(BACKEND, file)]);
    }
  }
  return found;
}

function undeclaredHosts(sources: Map<string, string[]>, declared: string): string[] {
  const out: string[] = [];
  for (const [host, files] of sources) {
    if (host in NOT_AN_ENDPOINT || declared.includes(host)) continue;
    out.push(`${host} (${[...new Set(files)].slice(0, 3).join(", ")})`);
  }
  return out;
}

describe("OFFLINE-TEST-01: every outbound endpoint is declared once", () => {
  test("a host named in source is declared in the privacy table, a default-on read, or listed as not an endpoint", () => {
    const undeclared = undeclaredHosts(sourceHosts(), declaredText());
    expect(
      undeclared,
      `these hosts are contacted or named in source but declared nowhere. Declare each in the package's data_sources or in lib/privacy.ts, or add it to NOT_AN_ENDPOINT with a reason if it is never fetched`,
    ).toEqual([]);
  });

  test("an undeclared host is reported and a declared one is not (the guard itself is guarded)", () => {
    const sources = new Map([["undeclared-host.test", ["src/lib/x.ts"]], ["api.github.com", ["src/lib/updates.ts"]]]);
    const found = undeclaredHosts(sources, declaredText());
    expect(found.length).toBe(1);
    expect(found[0]).toContain("undeclared-host.test");
  });

  test("NOT_AN_ENDPOINT never hides a declared connection", () => {
    const declared = declaredText();
    for (const host of Object.keys(NOT_AN_ENDPOINT)) {
      if (host === "127.0.0.1" || host === "localhost") continue;
      expect(declared.includes(host), `${host} is declared as a connection, so it must not be listed as not an endpoint`).toBe(false);
    }
  });

  test("default-on public reads are named, with a reason, and none exist yet", () => {
    for (const read of DEFAULT_ON_PUBLIC_READS) {
      expect(read.host.length).toBeGreaterThan(0);
      expect(read.reason.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_ON_PUBLIC_READS.length).toBe(0);
  });
});
