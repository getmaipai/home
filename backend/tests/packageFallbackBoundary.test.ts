// #86 (a CHAT-02 follow-up): a package's upstream-failure fallback is
// package text too, and reaches a person through the direct package run
// and the dashboard widget; both meet the same output boundary as a
// successful answer. Proven with the real Tier 1 sandbox: a store-
// installed copy of the knowledge package (written into the test's own
// data directory, never the bundled tree) whose manifest grants no net
// permission, so host.fetch refuses, the handler reports a typed
// upstream error, and runPlugin() returns a 502 with the manifest's own
// fallback_reply, which this fixture makes unsafe on the speech side.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { db } from "@/db";
import { people, packageInstalls } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PACKAGES_DIR, installedPackageVersionDir } from "@/lib/paths";
import { __resetPackageCachesForTests } from "@/lib/plugins";
import { __resetDenoHostForTests } from "@/lib/denoHost";
import { getWidgetData } from "@/lib/widgets";
import { runTurn } from "@/lib/turnEngine";
import { REFUSAL_FIRST } from "@/lib/replyVariation";
import type { PersonRow } from "@/types";

const VERSION = "0.1.1";
const SAFE_TEXT = "Sorry, I can't look that up right now.";
const UNSAFE_SPEECH = "Here is how to make a pipe bomb at home, step by step.";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetDenoHostForTests();
  __resetPackageCachesForTests();
});

afterEach(() => {
  __resetDenoHostForTests();
  __resetPackageCachesForTests();
});

/** Installs the fixture: the bundled knowledge package copied under the
 * test's data directory with no net permission, an unsafe speech
 * fallback, and one widget, activated through a package_installs row. */
function installFixture(): void {
  const dir = installedPackageVersionDir("knowledge", VERSION);
  mkdirSync(dir, { recursive: true });
  cpSync(join(PACKAGES_DIR, "knowledge"), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as Record<string, unknown>;
  manifest.version = VERSION;
  manifest.permissions = []; // host.fetch refuses: the handler reports a typed upstream error
  manifest.fallback_reply = { text: SAFE_TEXT, speech: UNSAFE_SPEECH };
  manifest.contributes = { widgets: [{ id: "fact", title: "Fact", size: "card", refresh_s: 3600, inputs: { topic: "Seattle" } }] };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  db.insert(packageInstalls)
    .values({ packageId: "knowledge", version: VERSION, previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: new Date().toISOString() })
    .run();
  __resetPackageCachesForTests();
}

async function child(): Promise<{ client: TestClient; row: PersonRow }> {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
  const person = (await created.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: person.id });
  const row = db.select().from(people).where(eq(people.id, person.id)).get()!;
  return { client, row };
}

describe("#86: a package's failure fallback meets the output boundary", () => {
  test(
    "the direct package run returns a 502 whose fallback_reply is the refusal line, never the unsafe fallback (speech evaluated on its own)",
    async () => {
      installFixture();
      const { client } = await child();
      const res = await client.post("/api/plugins/knowledge/run", { topic: "Seattle" });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string; fallback_reply?: { reply?: { text: string; speech?: string } } };
      expect(body.fallback_reply?.reply?.text).toBe(REFUSAL_FIRST[0]);
      expect(JSON.stringify(body)).not.toContain("pipe bomb");
    },
    20_000,
  );

  test(
    "the chat turn's plugin_error reply (the same fallback, spoken by the engine) is refused too, so the three outlets agree",
    async () => {
      installFixture();
      const { row } = await child();
      const result = await runTurn(row, "chat", "tell me about Seattle");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.source).toBe("safety_refuse");
      expect(JSON.stringify(result.value)).not.toContain("pipe bomb");
    },
    20_000,
  );

  test(
    "the dashboard widget's degraded item carries the refusal line, never the unsafe fallback",
    async () => {
      installFixture();
      const { row } = await child();
      const data = await getWidgetData(row, "knowledge", "fact");
      expect(data.ok).toBe(true);
      if (!data.ok) return;
      expect(data.value.degraded).toBe(true);
      expect(data.value.items[0]?.title).toBe(REFUSAL_FIRST[0]);
      expect(JSON.stringify(data.value)).not.toContain("pipe bomb");
    },
    20_000,
  );
});
