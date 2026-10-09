#!/usr/bin/env bun
import { execSync } from "child_process";
const result = execSync("bun test tests/packageHost.test.ts 2>&1", {
  cwd: process.cwd(),
  encoding: "utf-8",
  maxBuffer: 10 * 1024 * 1024,
});
process.stdout.write(result);
const lines = result.split("\n");
const failing = lines.filter(l => l.includes("FAIL") || l.includes("✗"));
const passing = lines.filter(l => l.includes("PASS") || l.includes("✓"));
if (failing.length > 0) {
  console.error("\n--- FAILING ---");
  failing.forEach(l => console.error(l));
  process.exit(1);
} else if (passing.length > 0) {
  console.log("\nAll tests passed!");
  process.exit(0);
}
