import { describe, expect, it } from "bun:test";
import { sayFields } from "@/lib/sayEvidence";
import { toolResultContent } from "@/lib/composer";
import type { ToolExecutionOutcome } from "@/lib/turnContext";

function weather(data: Record<string, unknown>, status = "succeeded"): ToolExecutionOutcome {
  return { status, packageId: "weather", result: { data } } as unknown as ToolExecutionOutcome;
}

describe("sayFields (NAT-04)", () => {
  it("rounds weather temperatures to a spoken form", () => {
    expect(sayFields(weather({ temperature: 72.4, high: 78, low: 61, unit: "F" }))).toEqual({
      temperature: expect.any(String),
      high: expect.any(String),
      low: expect.any(String),
    });
  });
  it("is suppressed by exact", () => {
    expect(sayFields(weather({ temperature: 72.4, exact: true }))).toBeNull();
  });
  it("skips failed outcomes, other packages and non-numeric values", () => {
    expect(sayFields(weather({ temperature: 72 }, "failed"))).toBeNull();
    expect(sayFields({ status: "succeeded", packageId: "currency", result: { data: { amount: 5 } } } as unknown as ToolExecutionOutcome)).toBeNull();
    expect(sayFields(weather({ temperature: "n/a" }))).toBeNull();
  });
  it("puts say beside data in the evidence JSON and leaves exact data untouched", () => {
    const json = JSON.parse(toolResultContent(weather({ temperature: 72.4, unit: "F" })));
    expect(json.data.temperature).toBe(72.4);
    expect(typeof json.say.temperature).toBe("string");
  });
});
