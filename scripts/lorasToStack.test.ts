// STACK-LORAS-01 slice 5: the migration script against a fake Stack and a throwaway database. Never touches a real hub.
import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIVE_CONFIRM, checkLive, compareOne, homeToken, migrate, peopleOf } from "./lorasToStack";

const dir = mkdtempSync(join(tmpdir(), "lorasToStack-test-"));
const lora = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `n-${id}`, media: "picture", audience: "all-ages", availability: { who: "people", people: ["person-b", "person-a"] }, file: { sha256: "a".repeat(64) }, preview: null, ...extra });
const db = new Database(join(dir, "hub.db"));
db.run("create table loras (id text primary key, record text not null, removed_at text, trash_until text)");
db.run("create table adult_mark_log (id text primary key, item_id text)");
for (const l of [lora("lora-1"), lora("lora-2", { audience: "adult-only" })]) db.run("insert into loras values (?, ?, null, null)", [l.id, JSON.stringify(l)]);
db.run("insert into adult_mark_log values ('amark-1', 'lora-2')");
db.close();

const store = new Map<string, Record<string, any>>();
const server = Bun.serve({ port: 0, fetch: async (request) => {
  if (request.headers.get("x-maipai-home-token") !== "t".repeat(20)) return new Response("{}", { status: 401 });
  const url = new URL(request.url);
  if (request.method === "POST") {
    const { items } = (await request.json()) as { items: { lora: Record<string, any> }[] };
    return Response.json({ results: items.map(({ lora: l }) => {
      const had = store.get(l.id); const next = { id: l.id, name: l.name, media: l.media, sha256: l.file.sha256, classification: l.audience === "adult-only" ? "adult-only" : "all-ages", removed_at: null, trash_until: null, preview: null, home: l };
      store.set(l.id, next); return { id: l.id, result: had && JSON.stringify(had) === JSON.stringify(next) ? "unchanged" : "imported" };
    }) });
  }
  return Response.json({ loras: url.searchParams.get("removed") === "true" ? [] : [...store.values()] });
} });
afterAll(() => { server.stop(true); });
const opts = (apply: boolean) => ({ dbPath: join(dir, "hub.db"), dataDir: dir, stack: `http://127.0.0.1:${server.port}`, stackData: null, out: join(dir, "out"), apply });

test("the key comes from the environment or the Stack's key file, and is refused when absent", () => {
  expect(homeToken(null, { STACK_HOME_VIEW_TOKEN: "k".repeat(16) })).toBe("k".repeat(16));
  mkdirSync(join(dir, "sd", "keys"), { recursive: true }); writeFileSync(join(dir, "sd", "keys", "home-view-token"), `${"f".repeat(20)}\n`);
  expect(homeToken(join(dir, "sd"), {})).toBe("f".repeat(20));
  expect(() => homeToken(null, {})).toThrow("No Home key");
});

test("a live run is refused without --live and the confirmation word, and a scratch run needs neither", () => {
  const base = { apply: true, live: false, stack: "http://127.0.0.1:8770", db: "/x/hub.db", env: {} };
  expect(checkLive(base)).toContain("live");
  expect(checkLive({ ...base, live: true })).toContain("MAIPAI_LORAS_LIVE_CONFIRM");
  expect(checkLive({ ...base, live: true, env: { MAIPAI_LORAS_LIVE_CONFIRM: LIVE_CONFIRM } })).toBeNull();
  expect(checkLive({ ...base, db: "/usr/local/maipai-home/data/hub.db", stack: "http://127.0.0.1:8798" })).toContain("live");
  expect(checkLive({ ...base, stack: "http://127.0.0.1:8798" })).toBeNull();
  expect(checkLive({ ...base, apply: false })).toBeNull();
  expect(checkLive({ ...base, live: true, stack: "http://127.0.0.1:8798", env: { MAIPAI_LORAS_LIVE_CONFIRM: LIVE_CONFIRM } })).toContain("not");
});

test("a dry run posts nothing and reports the gap; apply imports every record and then matches; a second apply changes nothing", async () => {
  process.env.STACK_HOME_VIEW_TOKEN = "t".repeat(20);
  const dry = await migrate(opts(false));
  expect(dry.posted).toBe(0); expect(store.size).toBe(0); expect(dry.ok).toBe(false);
  const first = await migrate(opts(true));
  expect(first.results).toEqual({ imported: 2 }); expect(first.mismatches).toEqual([]); expect(first.ok).toBe(true);
  expect(first.homeCount).toBe(2); expect(first.stackCount).toBe(2);
  const second = await migrate(opts(true));
  expect(second.results).toEqual({ unchanged: 2 }); expect(second.ok).toBe(true);
  expect(second.backupSha256).toBe(first.backupSha256);
});

test("the people list, the adult tag and a lowered tag are compared field by field", () => {
  const home = { id: "lora-1", record: lora("lora-1", { audience: "adult-only" }), removedAt: null, trashUntil: null };
  const stack = { id: "lora-1", name: "n-lora-1", media: "picture", sha256: "a".repeat(64), classification: "all-ages", removed_at: null, trash_until: null, preview: null, home: { ...home.record, availability: { who: "people", people: ["person-a"] } } };
  const fields = compareOne(home, stack, true).map((m) => m.field);
  expect(fields).toContain("nsfw"); expect(fields).toContain("people");
  expect(peopleOf(home.record)).toEqual(["person-a", "person-b"]);
  expect(compareOne(home, undefined, true)[0]!.field).toBe("present");
});
