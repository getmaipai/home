import { describe, expect, test } from "bun:test";
import { countryFlag } from "@/lib/voice/countryFlag";
describe("countryFlag", () => {
  test("maps country and subdivision codes and unknown places", () => {
    expect(countryFlag("GB")).toBe("🇬🇧");
    expect(countryFlag("IE")).toBe("🇮🇪");
    expect(countryFlag("GB-SCT")).toBe("🏴󠁧󠁢󠁳󠁣󠁴󠁿");
    expect(countryFlag("GB-WLS")).toBe("🏴󠁧󠁢󠁷󠁬󠁳󠁿");
    expect(countryFlag("GB-NIR")).toBe("🏴󠁧󠁢󠁮󠁩󠁲󠁿");
    expect(countryFlag(null)).toBe("🌐");
  });
});
