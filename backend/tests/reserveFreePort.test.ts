import { afterEach, describe, expect, test } from "bun:test";
import { reserveFreePort } from "./fixtures/reserveFreePort";

const originalNoPorts = process.env.MAIPAI_TEST_NO_PORTS;

afterEach(() => {
  if (originalNoPorts === undefined) delete process.env.MAIPAI_TEST_NO_PORTS;
  else process.env.MAIPAI_TEST_NO_PORTS = originalNoPorts;
});

describe("reserveFreePort", () => {
  test("returns placeholder ports without binding when no-ports mode is enabled", () => {
    process.env.MAIPAI_TEST_NO_PORTS = "1";
    const originalServe = Bun.serve;
    Bun.serve = (() => {
      throw new Error("Bun.serve must not be called in no-ports mode");
    }) as typeof Bun.serve;

    try {
      for (let i = 0; i < 10; i++) {
        const port = reserveFreePort();
        expect(Number.isInteger(port)).toBe(true);
        expect(port).toBeGreaterThanOrEqual(20_000);
        expect(port).toBeLessThan(45_000);
      }
    } finally {
      Bun.serve = originalServe;
    }
  });

  test.skipIf(process.env.MAIPAI_TEST_NO_PORTS === "1")("returns a bindable port by default", () => {
    const port = reserveFreePort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThanOrEqual(20_000);
    expect(port).toBeLessThan(45_000);
  });
});
