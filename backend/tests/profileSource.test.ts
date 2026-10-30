import { afterEach, expect, test } from "bun:test";
import { fitForAdmission, getProfileSource, setProfileSource } from "@/lib/jobs/admissionFit";
import { profileSourceFromSettings, rowsFromSetting, weightsFromPriority } from "@/lib/jobs/profileSource";

afterEach(() => setProfileSource(null));

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
  expect(profileSourceFromSettings(() => undefined)).toBeNull();
  let table: unknown = spec;
  setProfileSource(() => profileSourceFromSettings((key) => (key === "resources.profiles" ? table : key === "resources.lower_without_asking.image" ? true : undefined)));
  expect(getProfileSource()?.lowerWithoutAsking.picture).toBe(true);
  const plenty = async () => ({ freeMemoryBytes: 100e9, loaded: [] });
  const fit = await fitForAdmission({ jobClass: "picture", tier: "max" }, plenty);
  expect(fit?.outcome).toBe("run");
  table = "{}";
  expect(await fitForAdmission({ jobClass: "picture", tier: "max" }, plenty)).toBeNull();
});
