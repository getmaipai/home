import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { scratch, origin, data, env, git, run, makeWorktree, commit, note, setup, cleanup } = fixtures.createLanderFixtures();

beforeAll(setup, 60_000);
afterAll(cleanup);

// GEN-DATADIR-01 (2026-11-02): the generate step imports backend code that opens <dataDir>/hub.db and throws SchemaTooNewError when
// the file is stamped newer than the build. A branch with a newer migration stamped the warm checkout's data/hub.db and every later
// landing bounced. The generate step must run against its own empty data directory.
const seen = join(scratch, "gen-data-dir.txt");
const stampTooNew = `mkdir -p data && bun -e 'import {Database} from "bun:sqlite"; const d=new Database("data/hub.db"); d.exec("PRAGMA user_version=9999"); d.close()'`;
// Stand-in for the backend: same data-directory rule as backend/src/lib/paths.ts, same refusal as db/schema-version.ts.
const openLikeBackend = `d="\${MAIPAI_DATA_DIR:-$PWD/data}"; printf '%s\\n' "$d" > "${seen}"; if [ -f "$d/hub.db" ]; then v=$(bun -e 'import {Database} from "bun:sqlite"; console.log(new Database(process.argv[1]).query("PRAGMA user_version").get().user_version)' "$d/hub.db"); [ "$v" -le 110 ] || { echo "SchemaTooNewError: $v"; exit 1; }; fi`;

function genScratchDirs() {
  return existsSync(data) ? readdirSync(data).filter((n) => n.startsWith(".gen-settings.")) : [];
}

describe("lander generate step data directory", () => {
  test("a too-new hub.db in the warm checkout does not bounce the landing; the scratch dir is gone afterwards", () => {
    env.MAIPAI_LAND_GENERATE_CMD = `${stampTooNew} && ${openLikeBackend}`;
    const wt = makeWorktree("gen_ok");
    writeFileSync(join(wt, "file.txt"), "gen ok\n");
    commit(wt, "gen ok");
    expect(run("land.sh", ["--detach"], wt).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(note("gen_ok").status).toBe("landed");
    const used = readFileSync(seen, "utf8").trim();
    expect(used).toContain(".gen-settings.");
    expect(used.startsWith(data)).toBe(true);
    expect(genScratchDirs()).toEqual([]);
    expect(existsSync(used)).toBe(false);
  }, 60_000);

  test("the scratch dir is removed when the generate step fails", () => {
    env.MAIPAI_LAND_GENERATE_CMD = `${openLikeBackend}; echo boom; exit 3`;
    const wt = makeWorktree("gen_fail");
    writeFileSync(join(wt, "file.txt"), "gen fail\n");
    commit(wt, "gen fail");
    const oldMain = git(origin, "rev-parse", "main");
    expect(run("land.sh", ["--detach"], wt).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(note("gen_fail").status).toBe("bounced");
    expect(note("gen_fail").reason).toContain("generated files failed");
    expect(git(origin, "rev-parse", "main")).toBe(oldMain);
    expect(genScratchDirs()).toEqual([]);
  }, 60_000);

  test("a leftover scratch dir older than a day is swept; a fresh one is kept", () => {
    env.MAIPAI_LAND_GENERATE_CMD = "true";
    mkdirSync(join(data, ".gen-settings.OLD123", "data"), { recursive: true });
    mkdirSync(join(data, ".gen-settings.NEW123", "data"), { recursive: true });
    const old = new Date(Date.now() - 3 * 86_400_000);
    utimesSync(join(data, ".gen-settings.OLD123"), old, old);
    const wt = makeWorktree("gen_sweep");
    writeFileSync(join(wt, "file.txt"), "gen sweep\n");
    commit(wt, "gen sweep");
    expect(run("land.sh", ["--detach"], wt).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(note("gen_sweep").status).toBe("landed");
    expect(existsSync(join(data, ".gen-settings.OLD123"))).toBe(false);
    expect(existsSync(join(data, ".gen-settings.NEW123"))).toBe(true);
  }, 60_000);
});
