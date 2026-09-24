// REFERENCE-LIBRARY-01. Deterministic and offline: a scripted stand-in
// for Kiwix's own public catalog and .meta4 sidecar (this file never
// reaches library.kiwix.org or download.kiwix.org), the same "drive the
// code, don't touch the network" shape kiwixSidecar.test.ts already
// uses. The real catalog, a real download and a real swap are proven
// live instead (scripts/bench/reference-library-01-live.ts, dev.md has
// the numbers).
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  resolveReferenceFlavour,
  installReferenceFlavour,
  installAndPublishReferenceFlavour,
} from "@/lib/referenceLibrary";
import { setHouseholdSettingValue } from "@/lib/settings";
import { listIssues } from "@/lib/issues";
import { resetDb } from "./reset-db";
import { __resetFixHandlersForTests } from "@/lib/issues";

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
});

function sha256Of(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** A scripted stand-in for library.kiwix.org's own catalog v2 entries
 * feed plus its .meta4 sidecars - `zimBody` is served in place of the
 * real ZIM bytes at the path the meta4's own link names, matching the
 * real shape verified live against library.kiwix.org and
 * download.kiwix.org, 2026-09-24 (docs/dev.md). */
function startFakeKiwixCatalog(entries: Array<{ name: string; flavour: string; zimBody: string; zimFileName?: string }>): ReturnType<typeof Bun.serve> {
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port: 0,
    fetch(req): Response {
      const url = new URL(req.url);
      if (url.pathname === "/catalog/v2/entries") {
        const xmlEntries: string = entries
          .map((e) => {
            const zimFileName = e.zimFileName ?? `${e.name}_${e.flavour}_2026-09.zim`;
            return `<entry>
              <name>${e.name}</name>
              <flavour>${e.flavour}</flavour>
              <language>eng</language>
              <link rel="http://opds-spec.org/acquisition/open-access" type="application/x-zim"
                href="http://127.0.0.1:${server.port}/zim/${zimFileName}.meta4" length="${e.zimBody.length}" />
            </entry>`;
          })
          .join("\n");
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${xmlEntries}</feed>`,
          { headers: { "content-type": "application/atom+xml" } },
        );
      }
      const meta4Match = /^\/zim\/(.+)\.meta4$/.exec(url.pathname);
      if (meta4Match) {
        const zimFileName = meta4Match[1]!;
        const entry = entries.find((e) => (e.zimFileName ?? `${e.name}_${e.flavour}_2026-09.zim`) === zimFileName);
        if (!entry) return new Response("not found", { status: 404 });
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><metalink xmlns="urn:ietf:params:xml:ns:metalink">
            <file name="${zimFileName}">
              <size>${entry.zimBody.length}</size>
              <hash type="sha-256">${sha256Of(entry.zimBody)}</hash>
            </file>
          </metalink>`,
          { headers: { "content-type": "application/metalink4+xml" } },
        );
      }
      const zimMatch = /^\/zim\/(.+)\.zim$/.exec(url.pathname);
      if (zimMatch) {
        const zimFileName = `${zimMatch[1]}.zim`;
        const entry = entries.find((e) => (e.zimFileName ?? `${e.name}_${e.flavour}_2026-09.zim`) === zimFileName);
        if (!entry) return new Response("not found", { status: 404 });
        return new Response(entry.zimBody);
      }
      return new Response("not found", { status: 404 });
    },
  });
  return server;
}

describe("resolveReferenceFlavour()", () => {
  test("resolves a real-shaped catalog entry to its own name, zimUrl, sha256 and size", async () => {
    const server = startFakeKiwixCatalog([{ name: "vikidia_en_all", flavour: "nopic", zimBody: "hello vikidia" }]);
    try {
      const resolved = await resolveReferenceFlavour("vikidia", "eng", "nopic", `http://127.0.0.1:${server.port}/catalog/v2/entries`);
      expect(resolved.name).toBe("vikidia_en_all");
      expect(resolved.flavour).toBe("nopic");
      expect(resolved.sha256).toBe(sha256Of("hello vikidia"));
      expect(resolved.sizeBytes).toBe("hello vikidia".length);
      expect(resolved.zimUrl.endsWith(".zim")).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("an unknown flavour throws a clear error, never a guessed match", async () => {
    const server = startFakeKiwixCatalog([{ name: "vikidia_en_all", flavour: "nopic", zimBody: "x" }]);
    try {
      await expect(resolveReferenceFlavour("vikidia", "eng", "maxi", `http://127.0.0.1:${server.port}/catalog/v2/entries`)).rejects.toThrow(
        /no "maxi" flavour/,
      );
    } finally {
      server.stop(true);
    }
  });
});

describe("installReferenceFlavour()", () => {
  test("a first install writes the ZIM to its own stable slot, replacedPrevious is false", async () => {
    const libraryDir = join(process.env.MAIPAI_DATA_DIR!, "first-install");
    setHouseholdSettingValue("reference.library_dir", libraryDir);
    const server = startFakeKiwixCatalog([{ name: "vikidia_en_all", flavour: "nopic", zimBody: "v1 content" }]);
    try {
      const result = await installReferenceFlavour("vikidia", "eng", "nopic", {
        catalogUrl: `http://127.0.0.1:${server.port}/catalog/v2/entries`,
      });
      expect(result.replacedPrevious).toBe(false);
      expect(result.path).toBe(join(libraryDir, "vikidia_en_all_nopic.zim"));
      expect(readFileSync(result.path, "utf-8")).toBe("v1 content");
    } finally {
      server.stop(true);
    }
  });

  test("an update keeps the old file fully readable until the new one verifies, then swaps in place", async () => {
    const libraryDir = join(process.env.MAIPAI_DATA_DIR!, "update-swap");
    mkdirSync(libraryDir, { recursive: true });
    const stablePath = join(libraryDir, "vikidia_en_all_nopic.zim");
    writeFileSync(stablePath, "old content, still being served");
    setHouseholdSettingValue("reference.library_dir", libraryDir);
    const server = startFakeKiwixCatalog([{ name: "vikidia_en_all", flavour: "nopic", zimBody: "new content" }]);
    try {
      // Before the install, the old file is exactly what a running
      // kiwix-serve would have open - prove it is untouched right up to
      // the call, then prove the swap replaced it afterward.
      expect(readFileSync(stablePath, "utf-8")).toBe("old content, still being served");
      const result = await installReferenceFlavour("vikidia", "eng", "nopic", {
        catalogUrl: `http://127.0.0.1:${server.port}/catalog/v2/entries`,
      });
      expect(result.replacedPrevious).toBe(true);
      expect(readFileSync(stablePath, "utf-8")).toBe("new content");
      expect(existsSync(`${stablePath}.incoming`)).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("a hash mismatch throws and leaves the previous copy completely untouched, never a corrupt file in its place", async () => {
    const libraryDir = join(process.env.MAIPAI_DATA_DIR!, "hash-failure");
    mkdirSync(libraryDir, { recursive: true });
    const stablePath = join(libraryDir, "vikidia_en_all_nopic.zim");
    writeFileSync(stablePath, "the real, previously-verified copy");
    setHouseholdSettingValue("reference.library_dir", libraryDir);
    // The catalog's own meta4 promises a sha256 for "new content", but
    // the server serves different bytes at the .zim path - the
    // corrupted-byte scenario the work order's own acceptance evidence
    // names, without needing to actually corrupt a byte on the wire.
    const server: ReturnType<typeof Bun.serve> = Bun.serve({
      port: 0,
      fetch(req): Response {
        const url = new URL(req.url);
        if (url.pathname === "/catalog/v2/entries") {
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
              <entry><name>vikidia_en_all</name><flavour>nopic</flavour><language>eng</language>
                <link rel="http://opds-spec.org/acquisition/open-access" type="application/x-zim"
                  href="http://127.0.0.1:${server.port}/zim/x.zim.meta4" length="11" /></entry>
            </feed>`,
            { headers: { "content-type": "application/atom+xml" } },
          );
        }
        if (url.pathname === "/zim/x.zim.meta4") {
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?><metalink xmlns="urn:ietf:params:xml:ns:metalink">
              <file name="x.zim"><size>11</size><hash type="sha-256">${sha256Of("new content")}</hash></file>
            </metalink>`,
          );
        }
        if (url.pathname === "/zim/x.zim") return new Response("CORRUPTED!!");
        return new Response("not found", { status: 404 });
      },
    });
    try {
      await expect(
        installReferenceFlavour("vikidia", "eng", "nopic", { catalogUrl: `http://127.0.0.1:${server.port}/catalog/v2/entries` }),
      ).rejects.toThrow(/failed to install/);
      expect(readFileSync(stablePath, "utf-8")).toBe("the real, previously-verified copy");
      expect(existsSync(`${stablePath}.incoming`)).toBe(false);
      expect(existsSync(`${stablePath}.incoming.part`)).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});

describe("installReferenceFlavour(): concurrent installs of the same slot", () => {
  test("a second call for the same book/language/flavour while one is already in flight is refused, never racing the same files", async () => {
    const libraryDir = join(process.env.MAIPAI_DATA_DIR!, "concurrent");
    setHouseholdSettingValue("reference.library_dir", libraryDir);
    let releaseZim: (() => void) | undefined;
    const zimGate = new Promise<void>((resolve) => (releaseZim = resolve));
    const server: ReturnType<typeof Bun.serve> = Bun.serve({
      port: 0,
      async fetch(req): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname === "/catalog/v2/entries") {
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
              <entry><name>vikidia_en_all</name><flavour>nopic</flavour><language>eng</language>
                <link rel="http://opds-spec.org/acquisition/open-access" type="application/x-zim"
                  href="http://127.0.0.1:${server.port}/zim/x.zim.meta4" length="1" /></entry>
            </feed>`,
          );
        }
        if (url.pathname === "/zim/x.zim.meta4") {
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?><metalink xmlns="urn:ietf:params:xml:ns:metalink">
              <file name="x.zim"><size>1</size><hash type="sha-256">${sha256Of("x")}</hash></file>
            </metalink>`,
          );
        }
        if (url.pathname === "/zim/x.zim") {
          await zimGate; // held open until the second call has already been refused
          return new Response("x");
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const first = installReferenceFlavour("vikidia", "eng", "nopic", { catalogUrl: `http://127.0.0.1:${server.port}/catalog/v2/entries` });
      await new Promise((r) => setTimeout(r, 50)); // let the first call reach the in-flight download
      await expect(
        installReferenceFlavour("vikidia", "eng", "nopic", { catalogUrl: `http://127.0.0.1:${server.port}/catalog/v2/entries` }),
      ).rejects.toThrow(/already installing/);
      releaseZim!();
      const result = await first;
      expect(result.resolved.name).toBe("vikidia_en_all");
    } finally {
      server.stop(true);
    }
  });
});

describe("installAndPublishReferenceFlavour(): the failure path", () => {
  test("a failed install raises a real Repairs issue with a working retry fix, never a silent failure", async () => {
    const libraryDir = join(process.env.MAIPAI_DATA_DIR!, "publish-failure");
    setHouseholdSettingValue("reference.library_dir", libraryDir);
    const server = startFakeKiwixCatalog([{ name: "vikidia_en_all", flavour: "nopic", zimBody: "x" }]);
    try {
      await expect(
        installAndPublishReferenceFlavour("vikidia", "eng", "maxi", { catalogUrl: `http://127.0.0.1:${server.port}/catalog/v2/entries` }),
      ).rejects.toThrow(/no "maxi" flavour/);
      const issue = listIssues().find((i) => i.source === "reference-library");
      expect(issue).toBeDefined();
      expect(issue!.fix?.action).toBe("retry_reference_install:vikidia:eng:maxi");
    } finally {
      server.stop(true);
    }
  });
});
