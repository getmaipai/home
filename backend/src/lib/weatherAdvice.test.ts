import { describe, expect, test } from "bun:test";
import { weatherAdvice, adviceLine, type AdviceInput } from "@/lib/weatherAdvice";

const base: AdviceInput = { unit: "fahrenheit", feelsLike: 72, isDay: true, code: 0, uvIndex: 1, windKph: 5, precipitationMm: 0, hourPop: [], hourTimes: [] };
const ids = (input: Partial<AdviceInput>) => weatherAdvice({ ...base, ...input }).map((item) => item.id);

describe("clothing by feels-like (Fahrenheit)", () => {
  test.each([
    [27, "hat-gloves"], [28, "heavy-coat"], [31, "heavy-coat"], [32, "jacket"], [59, "jacket"], [60, "light-jacket"], [67, "light-jacket"],
  ])("%i degrees", (feelsLike, id) => expect(ids({ feelsLike })).toContain(id));
  test("68 and warmer needs no layer", () => {
    const got = ids({ feelsLike: 68 });
    expect(got.filter((id) => ["hat-gloves", "heavy-coat", "jacket", "light-jacket"].includes(id))).toEqual([]);
  });
  test("only one clothing item is given", () => expect(ids({ feelsLike: 10 }).filter((id) => ["hat-gloves", "heavy-coat", "jacket", "light-jacket"].includes(id))).toEqual(["hat-gloves"]));
});

describe("Celsius gives the same advice as the same Fahrenheit reading", () => {
  test("0 C is 32 F: jacket", () => expect(ids({ unit: "celsius", feelsLike: 0 })).toContain("jacket"));
  test("-3 C is 26.6 F: hat and gloves", () => expect(ids({ unit: "celsius", feelsLike: -3 })).toContain("hat-gloves"));
  test("20 C is 68 F: no layer", () => expect(ids({ unit: "celsius", feelsLike: 20 }).filter((id) => id.includes("jacket"))).toEqual([]));
});

describe("rain over the next 12 hours", () => {
  const times = Array.from({ length: 24 }, (_, i) => `2026-10-27T${String(i).padStart(2, "0")}:00`);
  test("under 30 percent: nothing", () => expect(ids({ hourPop: [10, 29], hourTimes: times })).not.toContain("umbrella"));
  test("30 percent: umbrella", () => expect(ids({ hourPop: [0, 30], hourTimes: times })).toContain("umbrella"));
  test("70 percent: rain gear instead of an umbrella", () => {
    const got = ids({ hourPop: [0, 70], hourTimes: times });
    expect(got).toContain("rain-gear");
    expect(got).not.toContain("umbrella");
  });
  test("50 percent adds boots", () => expect(ids({ hourPop: [50], hourTimes: times })).toContain("boots"));
  test("wet ground now adds boots", () => expect(ids({ precipitationMm: 2.54 })).toContain("boots"));
  test("a chance after hour 12 does not count", () => expect(ids({ hourPop: [...Array(12).fill(0), 90], hourTimes: times })).not.toContain("umbrella"));
  test("the wording names the first wet hour", () => {
    const item = weatherAdvice({ ...base, hourPop: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 60], hourTimes: times }).find((i) => i.id === "rain-timing");
    expect(item).toBeUndefined();
    const soon = weatherAdvice({ ...base, hourPop: [0, 0, 60], hourTimes: times }).find((i) => i.id === "rain-timing");
    expect(soon?.text).toBe("Rain is likely around 2 AM.");
  });
});

describe("sun, on the kit's UV bands (3, 6, 8)", () => {
  test("UV 2: nothing", () => expect(ids({ uvIndex: 2 })).toEqual([]));
  test("UV 3 on a clear day: sunglasses only", () => {
    const got = ids({ uvIndex: 3 });
    expect(got).toContain("sunglasses");
    expect(got).not.toContain("sunscreen");
  });
  test("UV 6: sunscreen and shade", () => {
    const got = ids({ uvIndex: 6 });
    expect(got).toContain("sunscreen");
    expect(got).toContain("shade");
  });
  test("a cloudy sky drops sunglasses but keeps sunscreen", () => {
    const got = ids({ uvIndex: 7, code: 3 });
    expect(got).not.toContain("sunglasses");
    expect(got).toContain("sunscreen");
  });
  test("at night there is no sun advice", () => expect(ids({ uvIndex: 9, isDay: false })).toEqual([]));
});

describe("wind", () => {
  test("25 km/h is breezy", () => expect(ids({ windKph: 25 })).toContain("breezy"));
  test("40 km/h is windy, not both", () => {
    const got = ids({ windKph: 40 });
    expect(got).toContain("windy");
    expect(got).not.toContain("breezy");
  });
  test("calm is nothing", () => expect(ids({ windKph: 24 })).toEqual([]));
});

describe("missing readings give no advice and never throw", () => {
  test("nothing known", () => expect(weatherAdvice({ unit: "fahrenheit" })).toEqual([]));
  test("garbage numbers", () => expect(weatherAdvice({ ...base, feelsLike: Number.NaN, uvIndex: Number.POSITIVE_INFINITY })).toEqual([]));
});

describe("adviceLine", () => {
  test("joins the texts", () => expect(adviceLine(weatherAdvice({ ...base, feelsLike: 50, uvIndex: 7 }))).toBe("Wear a jacket. Wear sunscreen. Look for shade. Wear sunglasses."));
  test("empty advice is an empty line", () => expect(adviceLine([])).toBe(""));
});

describe("adviceFromRecipeData", () => {
  const { adviceFromRecipeData } = require("@/lib/weatherAdvice") as typeof import("@/lib/weatherAdvice");
  test("reads the recipe's bound keys", () => {
    const got = adviceFromRecipeData({ unit: "fahrenheit", block_detail_feels_like: 45, block_detail_uv_index: 7, block_code: 1, block_is_day: 1, block_hour_pop: [0, 80], block_hour_times: ["2026-10-27T09:00", "2026-10-27T10:00"] });
    expect(got.map((item) => item.id)).toEqual(["jacket", "rain-gear", "boots", "rain-timing", "sunscreen", "shade", "sunglasses"]);
  });
  test("no data is no advice", () => expect(adviceFromRecipeData(undefined)).toEqual([]));
});

describe("adviceChips", () => {
  const { adviceChips } = require("@/lib/weatherAdvice") as typeof import("@/lib/weatherAdvice");
  test("short labels, a sun icon on the sun items, rain timing kept", () => {
    const chips = adviceChips(weatherAdvice({ ...base, feelsLike: 45, uvIndex: 7 }));
    expect(chips.find((chip) => chip.id === "jacket")?.label).toBe("Jacket");
    expect(chips.find((chip) => chip.id === "sunscreen")).toEqual({ id: "sunscreen", label: "Sunscreen", icon: "sun" });
    expect(chips.every((chip) => typeof chip.icon === "string")).toBe(true);
    expect(chips.every((chip) => chip.label.length <= 24)).toBe(true);
  });
  test("no advice, no chips", () => expect(adviceChips([])).toEqual([]));
});
