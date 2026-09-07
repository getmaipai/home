import { describe, expect, test } from "bun:test";
import { checkTestIsolation, snapshotTestIsolation, PRODUCTION_CHAT_PORT } from "./isolation";

// Drives checkTestIsolation() against a plain object, never process.env
// itself - the real guard (installed by tests/preload.ts) is already
// watching this very test, and deliberately breaking process.env here
// to prove the guard would just make this test the one it fails.
function fakeEnv(): Record<string, string | undefined> {
  return {
    MAIPAI_DATA_DIR: "/tmp/maipai-home-test-abc",
    MAIPAI_BACKUP_DIR: "/tmp/maipai-home-test-backups-abc",
    MAIPAI_KEYSTORE_BACKEND: "file",
    MAIPAI_TTS_DISABLE_SPAWN: "1",
    MAIPAI_LLAMA_SERVER_PORT: "48788",
  };
}

// Reads by a plain `string` key on purpose: after a `delete env.X` above,
// TS narrows `env.X` itself to `undefined` (which is the point of the
// test), and that narrowing would make asserting the restored value a
// type error rather than a real check.
function read(env: Record<string, string | undefined>, key: string): string | undefined {
  return env[key];
}

describe("test isolation guard", () => {
  test("an intact environment reports nothing", () => {
    const env = fakeEnv();
    expect(checkTestIsolation(env, snapshotTestIsolation(env))).toEqual([]);
  });

  // The exact live bug: a tidy-up `delete` of the chat port, which turned
  // the next spawning test into a SIGKILL of the real engine.
  test("an unset chat port is reported by name and put back", () => {
    const env = fakeEnv();
    const expected = snapshotTestIsolation(env);
    delete env.MAIPAI_LLAMA_SERVER_PORT;
    const violations = checkTestIsolation(env, expected);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ name: "MAIPAI_LLAMA_SERVER_PORT", restoredTo: "48788" });
    expect(violations[0]!.found).toBeUndefined();
    expect(read(env, "MAIPAI_LLAMA_SERVER_PORT")).toBe("48788");
  });

  test("the chat port pointed at the production default is as bad as unset", () => {
    const env = fakeEnv();
    const expected = snapshotTestIsolation(env);
    env.MAIPAI_LLAMA_SERVER_PORT = PRODUCTION_CHAT_PORT;
    const names: string[] = checkTestIsolation(env, expected).map((v) => v.name);
    expect(names).toEqual(["MAIPAI_LLAMA_SERVER_PORT"]);
    expect(env.MAIPAI_LLAMA_SERVER_PORT).toBe("48788");
  });

  test("a test's own throwaway chat port is allowed", () => {
    const env = fakeEnv();
    const expected = snapshotTestIsolation(env);
    env.MAIPAI_LLAMA_SERVER_PORT = "39302";
    expect(checkTestIsolation(env, expected)).toEqual([]);
    expect(env.MAIPAI_LLAMA_SERVER_PORT).toBe("39302");
  });

  test("a changed data dir or a real TTS spawn is reported and restored", () => {
    const env = fakeEnv();
    const expected = snapshotTestIsolation(env);
    env.MAIPAI_DATA_DIR = "/Users/someone/real/data";
    delete env.MAIPAI_TTS_DISABLE_SPAWN;
    const names: string[] = checkTestIsolation(env, expected).map((v) => v.name).sort();
    expect(names).toEqual(["MAIPAI_DATA_DIR", "MAIPAI_TTS_DISABLE_SPAWN"]);
    expect(env.MAIPAI_DATA_DIR).toBe("/tmp/maipai-home-test-abc");
    expect(read(env, "MAIPAI_TTS_DISABLE_SPAWN")).toBe("1");
  });
});
