import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setReferenceCatalogUrlForTests, planReference, applyReference, getReferenceState, controlReferenceJob } from "@/lib/referencePresetEngine";
import { listInstalledReferenceFlavours } from "@/lib/referenceLibrary";
import { removeInstalledReferenceFlavour } from "@/lib/referenceLibrary";

const bodies = new Map<string, string>();
let server: ReturnType<typeof Bun.serve>;
server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req): Response {
  const u = new URL(req.url);
  if (u.pathname === "/catalog/v2/entries") {
    const entries = [...bodies.keys()].map((key) => {
      const [book, flavor] = key.split(":"); const body = bodies.get(key)!; const name = book;
      return `<entry><name>${name}</name><flavour>${flavor}</flavour><link rel="http://opds-spec.org/acquisition/open-access" href="http://127.0.0.1:${server.port}/zim/${name}${flavor ? `_${flavor}` : ""}_2026-09.zim.meta4" /></entry>`;
    }).join("");
    return new Response(`<feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`);
  }
  const meta = /\/zim\/(.+)\.meta4$/.exec(u.pathname);
  if (meta) { const name = meta[1]!; const match = [...bodies.entries()].find(([key]) => { const [book, flavor] = key.split(":"); return name === `${book}${flavor ? `_${flavor}` : ""}_2026-09.zim`; }); if (!match) return new Response("missing", { status: 404 }); const bytes = new TextEncoder().encode(match[1]); return new Response(`<metalink><file name="${name}"><size>${bytes.length}</size><hash type="sha-256">${createHash("sha256").update(bytes).digest("hex")}</hash></file></metalink>`); }
  return new Response("fixture zim");
} });

beforeEach(() => {
  resetDb(); bodies.clear();
  for (const book of ["vikidia_en_all", "wikipedia_en-simple_all", "wikipedia_en_all", "wiktionary_en-simple_all", "wiktionary_en_all", "wikivoyage_en_all", "wikibooks_en_all", "stackexchange"]) for (const flavor of ["nopic", "mini", "maxi"]) bodies.set(`${book}:${flavor}`, `${book} ${flavor} snapshot`);
  for (const book of ["theworldfactbook_en_all", "medlineplus.gov_en_all"]) bodies.set(`${book}:`, `${book} snapshot`);
  const dir = join(process.env.MAIPAI_DATA_DIR!, "reference-presets"); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  setHouseholdSettingValue("reference.library_dir", dir);
  setHouseholdSettingValue("household.quiet_hours.from", "00:00"); setHouseholdSettingValue("household.quiet_hours.to", "23:59");
  setHouseholdSettingValue("reference.download.when", "anytime");
  __setReferenceCatalogUrlForTests(`http://127.0.0.1:${server.port}/catalog/v2/entries`);
});
afterEach(() => { __setReferenceCatalogUrlForTests(undefined); });

async function owner() { const c = new TestClient(); await c.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" }); return c; }
async function child(adult: TestClient) { const response = await adult.post("/api/people", { displayName: "Robin", role: "child", secret: "child-secret" }); const { id } = await response.json() as { id: string }; const c = new TestClient(); await c.post("/api/auth/verify-secret", { personId: id, secret: "child-secret" }); return c; }

describe("KS-REF-PRESETS-01 engine", () => {
  test("plans each pinned preset from live-shaped catalogue metadata", async () => {
    for (const preset of ["minimum", "moderate", "full"] as const) {
      const plan = await planReference(preset);
      expect(plan.sets.length).toBeGreaterThan(0); expect(plan.sets.every((set) => set.sizeBytes > 0 && set.sha256.length === 64)).toBe(true);
    }
  });

  test("plan warns when offline search has no Wikipedia set", async () => {
    setHouseholdSettingValue("search.source_mode", "offline");
    const plan = await planReference("custom", [{ source: "vikidia", flavour: "default" }]);
    expect(plan.warnings.join(" ")).toMatch(/Wikipedia results will not be available/i);
  });

  test("refuses a plan when installs would leave less than twenty percent free", async () => {
    const plan = await planReference("full", undefined, "/dev");
    expect(plan.refusal).toContain("20 percent");
  });

  test("Wikipedia resolves to the whole encyclopedia, never a topic edition that shares its prefix", async () => {
    bodies.set("wikipedia_en_football:maxi", "football maxi snapshot");
    const plan = await planReference("custom", [{ source: "wikipedia-en", flavour: "maxi" }, { source: "wikipedia-simple", flavour: "default" }]);
    expect(plan.sets.map((set) => set.name)).toEqual(["wikipedia_en_all", "wikipedia_en-simple_all"]);
  });

  test("applies idempotently, queues child sets first and Wikipedia last", async () => {
    const selection = [{ source: "world-factbook", flavour: "default" as const }, { source: "wikipedia-en", flavour: "mini" as const }, { source: "vikidia", flavour: "default" as const }];
    const first = await applyReference("custom", selection); const second = await applyReference("custom", selection);
    expect(first.idempotent).toBe(false); expect(second.idempotent).toBe(true);
    expect(first.jobs.map((job) => job.setId)).toEqual(["world-factbook:default", "vikidia:default", "wikipedia-en:mini"]);
  });

  test("persists interrupted work as resumable queued work and accepts pause/resume/cancel", () => {
    const dir = join(process.env.MAIPAI_DATA_DIR!, "reference-presets");
    writeFileSync(join(dir, ".reference-jobs.json"), JSON.stringify({ jobs: [{ id: "job-resume", setId: "vikidia:default", state: "downloading", completedBytes: 4, totalBytes: 80, message: "downloading" }], order: [], selection: [], settings: {} }));
    expect(getReferenceState().jobs[0]?.state).toBe("queued");
    expect(controlReferenceJob("job-resume", "pause")?.state).toBe("paused");
    expect(controlReferenceJob("job-resume", "resume")?.state).toBe("queued");
    expect(controlReferenceJob("job-resume", "cancel")?.state).toBe("cancelled");
  });

  test("admin endpoints reject a child", async () => {
    const adult = await owner(); const c = await child(adult);
    for (const res of [await c.post("/api/reference/plan", { preset: "minimum" }), await c.post("/api/reference/apply", { preset: "minimum" }), await c.get("/api/reference/state"), await c.post("/api/reference/sets/vikidia:default/install"), await c.post("/api/reference/sets/vikidia:default/remove")]) expect(res.status).toBe(403);
  });

  test("remove helper preserves files with no install record", async () => {
    const dir = join(process.env.MAIPAI_DATA_DIR!, "reference-presets"); const foreign = join(dir, "foreign.zim"); writeFileSync(foreign, "foreign");
    expect(listInstalledReferenceFlavours()).toEqual([]); expect(readFileSync(foreign, "utf8")).toBe("foreign");
  });

  test("Apply starts the download at once even when the nightly window is on and closed", async () => {
    setHouseholdSettingValue("reference.download.when", "window");
    setHouseholdSettingValue("household.quiet_hours.from", "00:00");
    setHouseholdSettingValue("household.quiet_hours.to", "00:01");
    const result = await applyReference("custom", [{ source: "vikidia", flavour: "default" }]);
    expect(result.jobs[0]?.state).toBe("queued");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(getReferenceState().jobs.some((j) => j.state === "waiting_window")).toBe(false);
  });

  test("remove deletes a recorded installed ZIM and metadata only", async () => {
    const dir = join(process.env.MAIPAI_DATA_DIR!, "reference-presets");
    const zim = join(dir, "vikidia_en_all_nopic.zim");
    writeFileSync(zim, "installed");
    writeFileSync(`${zim}.reference.json`, JSON.stringify({ id: "vikidia:eng:nopic", name: "vikidia_en_all", book: "vikidia", language: "eng", flavour: "nopic", snapshotDate: "2026-09" }));
    const foreign = join(dir, "foreign.zim"); writeFileSync(foreign, "foreign");
    const removed = await removeInstalledReferenceFlavour("vikidia:eng:nopic");
    expect(removed).toEqual({ removed: true, freedBytes: "installed".length });
    expect(readFileSync(foreign, "utf8")).toBe("foreign");
  });
});
