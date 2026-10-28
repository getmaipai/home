import { expect, test } from "bun:test";
import { initialFrame, visibleRegion } from "@/shell/pages/PictureCropper";

test("a fully zoomed-out picture is used whole", () => {
  expect(visibleRegion(initialFrame(400, 200), 400, 200)).toEqual({ sx: 0, sy: 0, sw: 400, sh: 200 });
});

test("zooming in 2x crops to the middle half of a square picture", () => {
  const region = visibleRegion({ zoom: 2, x: -144, y: -144 }, 100, 100);
  expect(region.sx).toBeCloseTo(25); expect(region.sw).toBeCloseTo(50); expect(region.sy).toBeCloseTo(25); expect(region.sh).toBeCloseTo(50);
});
