import { describe, expect, test } from "bun:test";
import { validateProfileTable, type Hardware, type ProfileRow } from "../src/lib/jobs/profileTable";

const hw: Hardware = { budgetGb: 116.8, marginGb: 20,
  residentGb: { chat: { standard: 36, reduced: 12 }, picture: { standard: 15.8, boost: 15.8 }, video: { standard: 15.8 } },
  peakGb: { video: { max: 80, boost: 40 }, picture: { boost: 60, max: 72 } } };
const companion: ProfileRow = { lead: "video", tier: "max", cells: { chat: { state: "reduced" }, picture: { state: "boost", phase: "before" }, music: { state: "queued" } } };
describe("profile table", () => {
  test("validates companion video and reports exact fit numbers", () => {
    expect(validateProfileTable([companion], hw).ok).toBe(true);
    const result = validateProfileTable([{ ...companion, cells: { ...companion.cells, chat: { state: "standard" } } }], hw);
    expect(result.errors[0]).toMatchObject({ needGb: 116, haveGb: 96.8 });
    expect(result.errors[0]!.message).toContain("needs about 116 GB with chat standard; this machine has 96.8 GB.");
  });
  test("rejects paused chat and missing figures; accepts video boost", () => {
    expect(validateProfileTable([{ ...companion, cells: { ...companion.cells, chat: { state: "queued" } } }], hw).errors[0]!.message).toBe("chat cannot be queued or off");
    const missing = validateProfileTable([{ lead: "video", tier: "boost", cells: { chat: { state: "standard" }, picture: { state: "max" } } }], hw);
    expect(missing.errors.some((error) => error.message.includes("no measured figure for picture max"))).toBe(true);
    expect(validateProfileTable([{ lead: "video", tier: "boost", cells: { chat: { state: "standard" }, picture: { state: "standard" }, music: { state: "queued" } } }], hw).ok).toBe(true);
  });
});
