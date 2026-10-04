import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const backendRoot = resolve(import.meta.dir, "..");
const scannedRoots = ["tests", "scripts", "src"].map((path) => resolve(backendRoot, path));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [path] : [];
  });
}

function publishCallsWithoutHost(source: string): string[] {
  // Assemble the matcher so this guard does not find its own example string.
  const callPattern = new RegExp("\\." + "publish\\s*\\(", "g");
  const missing: string[] = [];
  for (const match of source.matchAll(callPattern)) {
    const open = match.index! + match[0].length - 1;
    let depth = 1;
    let quote = "";
    let escaped = false;
    let end = open + 1;
    for (; end < source.length && depth > 0; end++) {
      const char = source[end]!;
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === "'" || char === '"' || char === "`") quote = char;
      else if (char === "(") depth++;
      else if (char === ")") depth--;
    }
    const call = source.slice(open + 1, end - 1);
    if (!/\bhost\s*:/.test(call)) missing.push(call.trim().slice(0, 120));
  }
  return missing;
}

describe("mDNS publish host safety", () => {
  test("every backend publish call declares an explicit host", () => {
    const violations = scannedRoots.flatMap((root) =>
      sourceFiles(root).flatMap((file) =>
        publishCallsWithoutHost(readFileSync(file, "utf8")).map((call) => `${file}: publish call has no host property: ${call}`),
      ),
    );
    expect(violations, "Every publish() call under backend/tests, backend/scripts, and backend/src must set host:").toEqual([]);
  });
});
