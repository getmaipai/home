import { expect, test } from "bun:test";
import { consoleUserHome } from "@/lib/appHelperClient";

test("root service finds the logged-in person's home", () => {
  const run = (cmd: string[]) => (cmd[0] === "stat" ? "sage\n" : "NFSHomeDirectory: /Users/sage\n");
  expect(consoleUserHome(run)).toBe("/Users/sage");
});
test("nobody logged in gives no home", () => {
  expect(consoleUserHome(() => "loginwindow\n")).toBeNull();
  expect(consoleUserHome(() => "root\n")).toBeNull();
});
test("falls back to /Users/<name> when the directory lookup is empty", () => {
  const run = (cmd: string[]) => (cmd[0] === "stat" ? "sage\n" : "");
  expect(consoleUserHome(run)).toBe("/Users/sage");
});
