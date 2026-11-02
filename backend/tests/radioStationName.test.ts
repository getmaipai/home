import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaSources } from "@/db/schema";
import { addStation, listSavedStations, savedStationFor } from "@/lib/media/radio";
import { STATION_NAME_MAX } from "@/lib/media/radioName";
import { stationOf } from "@/lib/media/radioDirectory";
import { owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

const LONG = "Sunrise FM | The best hits of the eighties, nineties and today, all day long https://sunrise.example.com";

beforeEach(() => resetDb());

describe("station names are cleaned at every door", () => {
  test("a name being saved is cleaned", async () => {
    const { row } = await owner();
    const added = addStation(row, { name: LONG, url: "https://stream.example.com/a.mp3" });
    if (!added.ok) throw new Error(added.error);
    expect(added.value.name).toBe("Sunrise FM");
  });
  test("an already saved long name is cleaned when read", async () => {
    const { row } = await owner();
    const added = addStation(row, { name: "Cabin FM", url: "https://stream.example.com/b.mp3" });
    if (!added.ok) throw new Error(added.error);
    db.update(mediaSources).set({ label: "x".repeat(110) }).where(eq(mediaSources.id, added.value.id)).run();
    expect(listSavedStations(row)[0]!.name.length).toBeLessThanOrEqual(STATION_NAME_MAX);
    expect(savedStationFor(row, added.value.id)!.name.endsWith("…")).toBe(true);
  });
  test("a directory row is cleaned", () => {
    const station = stationOf({ stationuuid: "abc", name: LONG, url_resolved: "https://stream.example.com/c.mp3" });
    expect(station?.name).toBe("Sunrise FM");
  });
});
