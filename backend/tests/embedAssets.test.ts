import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { EMBED_MODEL_FILE, embedModelPath, ensureEmbedModel } from "@/lib/embedAssets";
import { modelsDir } from "@/lib/paths";

// Deliberately never exercises a real download - same "trust the pin,
// pre-place a placeholder file so downloadUrl()'s existsSync short-
// circuit never reaches the network" discipline wakewordAssets.test.ts
// already uses, for the identical reason (.github/CLAUDE.md > Testing
// standards' "deterministic and offline by default").
afterEach(() => {
  rmSync(embedModelPath(), { force: true });
});

describe("lib/embedAssets.ts", () => {
  test("embedModelPath resolves under the shared models directory", () => {
    expect(embedModelPath()).toBe(`${modelsDir}/${EMBED_MODEL_FILE}`);
  });

  test("ensureEmbedModel never touches the network once the file already exists", async () => {
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(embedModelPath(), "placeholder");
    await ensureEmbedModel();
    expect(existsSync(embedModelPath())).toBe(true);
  });
});
