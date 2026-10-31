import { describe, expect, test } from "bun:test";
import { atBackgroundPriority } from "@/lib/backgroundPriority";

describe("atBackgroundPriority", () => {
  test("a Mac with taskpolicy runs the command at background priority", () => {
    expect(atBackgroundPriority(["ffmpeg", "-i", "a.mp4"], "darwin", () => true)).toEqual(["/usr/sbin/taskpolicy", "-b", "ffmpeg", "-i", "a.mp4"]);
  });
  test("another system, or a Mac without taskpolicy, runs it unchanged", () => {
    expect(atBackgroundPriority(["java"], "linux", () => true)).toEqual(["java"]);
    expect(atBackgroundPriority(["java"], "darwin", () => false)).toEqual(["java"]);
  });
});
