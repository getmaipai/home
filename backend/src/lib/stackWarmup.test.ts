import { expect, test } from "bun:test";
import { warmStack } from "@/lib/stackWarmup";

test("warming the Stack never throws when no Stack is configured or reachable", async () => {
  expect(typeof (await warmStack())).toBe("boolean");
});
