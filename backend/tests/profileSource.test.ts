import { afterEach, expect, test } from "bun:test";
import { fitForAdmission, getProfileSource, setProfileSource } from "@/lib/jobs/admissionFit";
import { hardwareFromBudget, profileSourceFromSettings, rowsFromSetting, weightsFromPriority } from "@/lib/jobs/profileSource";
import { __setHardwareForTests } from "@/lib/jobs/stackHardware";

afterEach(() => setProfileSource(null));

const gib = 1_073_741_824;
const budget = {
  totalMemoryBytes: 64 * gib, capBytes: 60 * gib, freeMemoryBytes: 0, availablePercent: 0,
  pressure: "normal" as const, memoryReadingDegraded: false, margin_bytes: 2 * gib, profile: "fixture",
  loaded: [{ id: "image-tools", kind: "resident" as const, peakBytes: gib, measured: true, lastUsedAt: "", idleTtlSeconds: 0, pinned: false, pid: null }],
  queue: [],
  slots: [
    { category: "chat" as const, tier: "reduced" as const, model: "chat-small", peak_bytes: 2 * gib, verified: true },
    { category: "chat" as const, tier: "standard" as const, model: "chat", peak_bytes: 4 * gib, verified: true },
    { category: "chat" as const, tier: "boost" as const, model: "chat-big", peak_bytes: 6 * gib, verified: true },
    { category: "pictures" as const, tier: "standard" as const, model: "image", peak_bytes: 8 * gib, verified: true },
    { category: "pictures" as const, tier: "boost" as const, model: "image-big", peak_bytes: 10 * gib, verified: false },
    { category: "video" as const, tier: "max" as const, model: "video", peak_bytes: 12 * gib, verified: true },
    { category: "music" as const, tier: "standard" as const, model: "music", peak_bytes: 3 * gib, verified: true },
  ],
};

test("budget rows become a measured hardware table", () => {
  const hw = hardwareFromBudget(budget)!;
  expect(hw.budgetGb).toBe(60);
  expect(hw.marginGb).toBe(2);
  expect(hw.residentGb.chat).toEqual({ reduced: 2, standard: 4, boost: 6 });
  expect(hw.peakGb.chat).toEqual({ standard: 4, boost: 6 });
  expect(hw.residentGb.picture).toEqual({ standard: 8 });
  expect(hw.peakGb.picture).toEqual({ standard: 8 });
  expect(hw.peakGb.video).toEqual({ max: 12 });
  expect(hw.residentGb.music).toEqual({ standard: 3 });
  expect(hw.residentGb.tools).toEqual({ standard: 1 });
  expect(hardwareFromBudget({ ...budget, loaded: [] })!.residentGb.tools).toBeUndefined();
  expect(hardwareFromBudget({ ...budget, slots: [] })).toBeNull();
  expect(hardwareFromBudget({ ...budget, slots: undefined })).toBeNull();
  expect(hardwareFromBudget({ ...budget, margin_bytes: undefined })).toBeNull();
});

const spec = JSON.stringify({ "image.max": { chat: "standard", image: "max", video: "queued", music: "queued", tools: "queued" }, "bogus.max": { chat: "standard" }, "video.boost": { chat: "standard", image: "wat" } });

test("the Performance page's table becomes rows; unknown rows and cells are skipped", () => {
  const rows = rowsFromSetting(spec);
  expect(rows.map((row) => `${row.lead}.${row.tier}`)).toEqual(["picture.max", "video.boost"]);
  expect(rows[0]!.cells.picture).toEqual({ state: "max" });
  expect(rows[1]!.cells.picture).toBeUndefined();
  expect(rowsFromSetting("not json")).toEqual([]);
});

test("priority list becomes weights, first is heaviest", () => {
  expect(weightsFromPriority('["chat","image","video","music"]')).toEqual({ chat: 4, picture: 3, video: 2, music: 1 });
});

test("no table means no source; settings are read at every admission", async () => {
  __setHardwareForTests(null);
  expect(profileSourceFromSettings(() => undefined)).toBeNull();
  const usableHardware = { budgetGb: 100, marginGb: 0, residentGb: { chat: { standard: 1 }, picture: { max: 1 } }, peakGb: { picture: { max: 1 } } };
  __setHardwareForTests(usableHardware);
  expect(profileSourceFromSettings((key) => key === "resources.profiles" ? spec : undefined)?.hw).toEqual(usableHardware);
  let table: unknown = spec;
  setProfileSource(() => profileSourceFromSettings((key) => (key === "resources.profiles" ? table : key === "resources.lower_without_asking.image" ? true : undefined)));
  expect(getProfileSource()?.lowerWithoutAsking.picture).toBe(true);
  const plenty = async () => ({ freeMemoryBytes: 100e9, loaded: [] });
  const fit = await fitForAdmission({ jobClass: "picture", tier: "max" }, plenty);
  expect(fit?.outcome).toBe("run");
  table = "{}";
  expect(await fitForAdmission({ jobClass: "picture", tier: "max" }, plenty)).toBeNull();
});
