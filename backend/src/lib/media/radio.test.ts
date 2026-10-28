import { describe, expect, test } from "bun:test";
import { adultTagged } from "@/lib/media/radio";

describe("adultTagged", () => {
  test("matches adult, porn, xxx and erotic tags in any case", () => {
    for (const tag of ["adult", "Adult Content", "porn", "XXX", "erotica", "erotic radio"]) expect(adultTagged(["jazz", tag])).toBe(true);
  });
  test("leaves ordinary tags alone", () => expect(adultTagged(["jazz", "talk", "contemporary"])).toBe(false));
});
