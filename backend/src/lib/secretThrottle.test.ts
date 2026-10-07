import { afterEach, expect, test } from "bun:test";
import { createAddressSlowdown } from "@/lib/secretThrottle";

let timestamp = 1_000_000;
const slowdown = createAddressSlowdown({ now: () => timestamp, maxAddresses: 2 });
afterEach(() => { slowdown.__resetForTests(); timestamp = 1_000_000; });

test("each failed attempt adds a growing delay capped at a finite wait", () => {
  expect(slowdown.check("household").blocked).toBe(false);
  slowdown.fail("household");
  expect(slowdown.check("household")).toEqual({ blocked: true, retryAfter: 1 });
  timestamp += 1_000;
  expect(slowdown.check("household").blocked).toBe(false);
  slowdown.fail("household");
  expect(slowdown.check("household").retryAfter).toBe(2);
  timestamp += 2_000;
  slowdown.fail("household");
  expect(slowdown.check("household").retryAfter).toBe(4);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    timestamp += 30_000;
    expect(slowdown.check("household").blocked).toBe(false);
    slowdown.fail("household");
  }
  expect(slowdown.check("household").retryAfter).toBe(30);
  timestamp += 30_000;
  expect(slowdown.check("household").blocked).toBe(false);
});

test("a successful sign-in clears only the address delay and state stays bounded", () => {
  slowdown.fail("household");
  slowdown.fail("satellite");
  slowdown.fail("proxy");
  expect(slowdown.__sizeForTests()).toBe(2);
  slowdown.reset("household");
  expect(slowdown.check("household").blocked).toBe(false);
});

test("an idle address window expires", () => {
  slowdown.fail("household");
  timestamp += 15 * 60_000;
  expect(slowdown.check("household").blocked).toBe(false);
});
