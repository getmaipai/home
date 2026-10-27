// NEWS-FOCAL-01: the hub finds a picture's focal point once, when it stores the picture, and the card carries it so the screen
// crops at once. The model itself is not loaded here (the importance map is built by hand); the promises: the weighted centre
// follows the bright cell and ignores the letterbox, a stored picture's point reaches the card, and a picture with no point
// (model not installed) still serves and its card simply has none.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { focalCentre, __setNewsFocalForTests } from "@/lib/news/focal";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetShelfCountersForTests } from "@/lib/shelf/shelfCounters";
import { __resetNewsCountersForTests } from "@/lib/news/newsCounters";
import { ADULT_HOST, installNewsApp, putItem, removeNewsApp, resetNewsState, seedFeeds, startPublisher, type Publisher } from "./support/newsFixture";

const blob = (cx: number, cy: number): Float32Array => {
  const map = new Float32Array(64 * 64);
  map[cy * 64 + cx] = 1;
  return map;
};

describe("focalCentre", () => {
  test("a single bright cell in a square picture gives its centre as a percentage", () => {
    const point = focalCentre(blob(48, 16), 1000, 1000)!;
    expect(point.x).toBeCloseTo(75.8, 0);
    expect(point.y).toBeCloseTo(26.2, 0);
    expect(point.aspect).toBe(1);
  });
  test("a wide picture ignores the letterbox rows and reports width over height", () => {
    const wide = new Float32Array(64 * 64).fill(0.5);
    for (let x = 0; x < 64; x++) { wide[x] = 5; wide[63 * 64 + x] = 5; } // bright border cells lie outside a 2:1 picture
    const point = focalCentre(wide, 2000, 1000)!;
    expect(point.aspect).toBe(2);
    expect(point.x).toBeCloseTo(50, 0);
    expect(point.y).toBeCloseTo(50, 0);
  });
  test("an empty map, a wrong-sized map or a zero-sized picture has no point", () => {
    expect(focalCentre(new Float32Array(64 * 64), 100, 100)).toBeNull();
    expect(focalCentre(new Float32Array(10), 100, 100)).toBeNull();
    expect(focalCentre(blob(1, 1), 0, 100)).toBeNull();
  });
});

describe("the card carries the stored picture's focal point", () => {
  let publisher: Publisher;
  let household: string;
  let point: { x: number; y: number; aspect: number } | null = { x: 62.5, y: 38, aspect: 1.5 };
  beforeAll(async () => {
    publisher = await startPublisher();
    __setNewsFocalForTests(async () => point);
  });
  afterAll(() => { publisher.stop(); __setNewsFocalForTests(null); });
  beforeEach(() => {
    resetDb(); resetNewsState(); __resetRateLimiterForTests(); __resetShelfCountersForTests(); __resetNewsCountersForTests();
    household = seedFeeds().household;
    publisher.attach();
  });
  afterEach(() => { publisher.detach(); removeNewsApp(); });

  test("no point before the picture is stored, the point after, and none when the model found none", async () => {
    installNewsApp();
    const { newsPicture, newsPictureFocal } = await import("@/lib/news/pictures");
    const first = putItem(household, ADULT_HOST);
    expect(newsPictureFocal(first.id)).toBeNull();
    point = { x: 62.5, y: 38, aspect: 1.5 };
    expect(await newsPicture(first, 480)).not.toBeNull();
    expect(newsPictureFocal(first.id)).toEqual({ x: 62.5, y: 38, aspect: 1.5 });
    const { imageOf } = await import("@/lib/news/cards");
    const env = { imagesOn: true } as Parameters<typeof imageOf>[3];
    expect(imageOf(first, "A story", "Wire", env)?.focal).toEqual({ x: 62.5, y: 38, aspect: 1.5 });
    const second = putItem(household, ADULT_HOST);
    point = null;
    expect(await newsPicture(second, 480)).not.toBeNull();
    expect(newsPictureFocal(second.id)).toBeNull();
    expect(imageOf(second, "A story", "Wire", env)).not.toHaveProperty("focal");
  });
});
