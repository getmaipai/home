import { beforeEach, describe, expect, test } from "bun:test";
import { deviceTiles, DEVICE_TILE_LIMIT } from "@/lib/house/widgetTiles";
import type { HouseEntity } from "@/lib/house/registry";
import { owner } from "../support/testAuth";
import { resetDb } from "../reset-db";

const entity = (id: string, name: string, kind: HouseEntity["kind"], state: string, extra: Partial<HouseEntity> = {}): HouseEntity => ({ id, name, kind, area: null, state, sensitive: null, deviceClass: null, rgb: null, brightness: null, sceneMembers: null, ...extra });

describe("deviceTiles", () => {
  test("shows plain states, locks first, and leaves out scenes, alarms and cameras", () => {
    const tiles = deviceTiles([
      entity("light.porch", "Porch", "light", "on"),
      entity("lock.front", "Front door", "lock", "locked", { sensitive: "lock" }),
      entity("cover.garage", "Garage", "cover", "open", { sensitive: "garage" }),
      entity("scene.movie", "Movie", "scene", "scening"),
      entity("camera.yard", "Yard", "camera", "idle", { sensitive: "camera" }),
      entity("alarm.home", "Alarm", "alarm", "armed_home", { sensitive: "alarm" }),
      entity("climate.hall", "Hall", "climate", "heat"),
      entity("fan.bed", "Bedroom fan", "fan", "unavailable"),
    ]);
    expect(tiles.map((tile) => [tile.name, tile.state, tile.on])).toEqual([
      ["Front door", "Locked", false], ["Garage", "Open", true], ["Porch", "On", true], ["Bedroom fan", "Not responding", false], ["Hall", "Heating", true],
    ]);
  });

  test("caps the card at the tile limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => entity(`light.l${i}`, `Lamp ${String(i).padStart(2, "0")}`, "light", "off"));
    expect(deviceTiles(many)).toHaveLength(DEVICE_TILE_LIMIT);
  });
});

describe("Devices widget", () => {
  beforeEach(() => resetDb());
  test("is declared by the house package as a tiles widget, and has no tiles when no house is connected", async () => {
    const { client } = await owner();
    const list = await (await client.get("/api/widgets")).json() as Array<{ package: string; id: string; size: string }>;
    expect(list).toContainEqual(expect.objectContaining({ package: "house", id: "devices", size: "tiles" }));
    const data = await (await client.get("/api/widgets/house/devices/data")).json() as { items: unknown[]; tiles?: unknown[] };
    expect(data.items).toEqual([]);
    expect(data.tiles).toBeUndefined();
  });
});
