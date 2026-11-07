import { expect, test } from "bun:test";
import { coreLabel } from "@/shell/coreLabels";

test("the household directory is titled Synths", () => {
  expect(coreLabel("/companions")).toBe("Synths");
});
