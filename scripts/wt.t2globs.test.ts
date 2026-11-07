import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? files(path) : [path];
  });
}
test("each non-migration T2 glob matches a repository file", () => {
  const line = readFileSync(join(import.meta.dir, "wt.sh"), "utf8").match(/^export WT_T2_GLOBS="(.*)"$/m)?.[1];
  expect(line).toBeTruthy();
  const paths = ["docs/design/RULES.md", ...files("scripts"), ...files("backend/src")];
  for (const glob of line!.split(" ").filter((item) => item !== "backend/src/db/migrations/*")) {
    const re = new RegExp(`^${glob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("\\*", ".*")}$`);
    expect(paths.some((path) => re.test(path)), glob).toBe(true);
  }
});
