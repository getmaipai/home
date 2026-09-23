import { describe, expect, test } from "bun:test";
import { checkTestIsolation, snapshotTestIsolation, PRODUCTION_CHAT_PORT, PRODUCTION_BACKGROUND_PORT, PRODUCTION_EMBED_PORT } from "./isolation";

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
    MAIPAI_LLAMA_SERVER_PORT: "39302",
    MAIPAI_BACKGROUND_PORT: "39303",
    MAIPAI_EMBED_PORT: "39304",
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
    expect(violations[0]).toMatchObject({ name: "MAIPAI_LLAMA_SERVER_PORT", restoredTo: "39302" });
    expect(violations[0]!.found).toBeUndefined();
    expect(read(env, "MAIPAI_LLAMA_SERVER_PORT")).toBe("39302");
  });

  test("the chat port pointed at the production default is as bad as unset", () => {
    const env = fakeEnv();
    const expected = snapshotTestIsolation(env);
    env.MAIPAI_LLAMA_SERVER_PORT = PRODUCTION_CHAT_PORT;
    const names: string[] = checkTestIsolation(env, expected).map((v) => v.name);
    expect(names).toEqual(["MAIPAI_LLAMA_SERVER_PORT"]);
    expect(env.MAIPAI_LLAMA_SERVER_PORT).toBe("39302");
  });

  test("a test's own throwaway chat port is allowed", () => {
    const env = fakeEnv();
    const expected = snapshotTestIsolation(env);
    env.MAIPAI_LLAMA_SERVER_PORT = "39302";
    expect(checkTestIsolation(env, expected)).toEqual([]);
    expect(env.MAIPAI_LLAMA_SERVER_PORT).toBe("39302");
  });

  // ENGINE-PORT-01: the identical shape as the chat-port tests above,
  // for background and embed - the two roles that had no isolation at
  // all until Fable traced a real household outage to exactly this gap.
  test("an unset background or embed port is reported by name and put back", () => {
    const env = fakeEnv();
    const expected = snapshotTestIsolation(env);
    delete env.MAIPAI_BACKGROUND_PORT;
    delete env.MAIPAI_EMBED_PORT;
    const violations = checkTestIsolation(env, expected).sort((a, b) => a.name.localeCompare(b.name));
    expect(violations).toHaveLength(2);
    expect(violations[0]).toMatchObject({ name: "MAIPAI_BACKGROUND_PORT", restoredTo: "39303" });
    expect(violations[1]).toMatchObject({ name: "MAIPAI_EMBED_PORT", restoredTo: "39304" });
    expect(read(env, "MAIPAI_BACKGROUND_PORT")).toBe("39303");
    expect(read(env, "MAIPAI_EMBED_PORT")).toBe("39304");
  });

  test("a background or embed port pointed at its production default is as bad as unset", () => {
    const env = fakeEnv();
    const expected = snapshotTestIsolation(env);
    env.MAIPAI_BACKGROUND_PORT = PRODUCTION_BACKGROUND_PORT;
    env.MAIPAI_EMBED_PORT = PRODUCTION_EMBED_PORT;
    const names = checkTestIsolation(env, expected).map((v) => v.name).sort();
    expect(names).toEqual(["MAIPAI_BACKGROUND_PORT", "MAIPAI_EMBED_PORT"]);
    expect(env.MAIPAI_BACKGROUND_PORT).toBe("39303");
    expect(env.MAIPAI_EMBED_PORT).toBe("39304");
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
