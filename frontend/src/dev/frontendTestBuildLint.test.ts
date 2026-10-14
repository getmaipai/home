import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? testFiles(path) : /\.(?:test|spec)\.[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

function defaultDistBuildFindings(sources: Record<string, string>): string[] {
  const command = /\b(?:(?:bun|npm|pnpm|yarn)\s+run\s+build|(?:bunx|npx)\s+vite\s+build|vite\s+build)\b/g;
  return Object.entries(sources).flatMap(([file, source]) => {
    const normalized = source.replace(/["'`]/g, "").replace(/[,[\]]/g, " ").replace(/\s+/g, " ");
    return [...normalized.matchAll(command)].flatMap((match) => {
      const invocation = normalized.slice(match.index, match.index + 180);
      const outputArg = /--outDir(?:\s+|=)([^\s]+)/.exec(invocation)?.[1];
      const output = outputArg?.replace(/\/+$/, "");
      return output && output !== "dist" && !output.endsWith("/dist") ? [] : [file];
    });
  });
}

describe("frontend test build destinations", () => {
  test("no frontend test spawns a build that writes the shared dist directory", () => {
    const lintTest = fileURLToPath(import.meta.url);
    const sources = Object.fromEntries(testFiles(SRC).filter((file) => file !== lintTest).map((file) => [file, readFileSync(file, "utf8")]));
    expect(defaultDistBuildFindings(sources)).toEqual([]);
  });

  test("the lint catches default Vite output and allows an explicit temporary output", () => {
    expect(defaultDistBuildFindings({
      "default.test.ts": 'spawnSync("bun", ["run", "build"]);',
      "vite-default.test.ts": 'spawnSync("bunx", ["vite", "build"]);',
      "vite-dist.test.ts": 'spawnSync("bunx", ["vite", "build", "--outDir", "./dist"]);',
      "temp.test.ts": 'spawnSync("bunx", ["vite", "build", "--outDir", tempDir]);',
    })).toEqual(["default.test.ts", "vite-default.test.ts", "vite-dist.test.ts"]);
  });
});
