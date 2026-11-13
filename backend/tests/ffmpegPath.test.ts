// MP-09: one finder for ffmpeg: the PATH first, then the Stack's own engines folder (newest version name wins).
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFfmpeg } from "@/lib/ffmpegPath";

let root = "";
let bin = "";
const tool = (dir: string) => { mkdirSync(dir, { recursive: true }); const file = join(dir, "ffmpeg"); writeFileSync(file, "#!/bin/sh\n"); chmodSync(file, 0o755); return file; };
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "maipai-ffmpeg-path-")); bin = join(root, "empty-bin"); mkdirSync(bin); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("a hub with no ffmpeg on the PATH finds the Stack's engine, newest version last in the sort", () => {
  tool(join(root, "stack", "engines", "ffmpeg", "v8.0.0-1"));
  const newest = tool(join(root, "stack", "engines", "ffmpeg", "v8.1.3-1"));
  expect(findFfmpeg(join(root, "stack"), bin)).toBe(newest);
});

test("a folder without the binary, or no engines folder at all, is null", () => {
  mkdirSync(join(root, "stack", "engines", "ffmpeg", "v8.1.3-1"), { recursive: true });
  expect(findFfmpeg(join(root, "stack"), bin)).toBeNull();
  expect(findFfmpeg(join(root, "no-stack"), bin)).toBeNull();
});

test("an ffmpeg on the PATH wins over the Stack's", () => {
  const onPath = tool(bin);
  tool(join(root, "stack", "engines", "ffmpeg", "v8.1.3-1"));
  expect(findFfmpeg(join(root, "stack"), bin)).toBe(onPath);
});
