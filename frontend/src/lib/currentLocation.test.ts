import { describe, expect, test } from "bun:test";
import { currentLocationIfGranted } from "./currentLocation";

function deps(state: string) {
  let asked = 0;
  return {
    asked: () => asked,
    permissions: { query: async () => ({ state }) as PermissionStatus },
    geolocation: {
      getCurrentPosition: (resolve: PositionCallback) => {
        asked += 1;
        resolve({ coords: { latitude: 47.60621, longitude: -122.33207 } } as GeolocationPosition);
      },
    },
  };
}

describe("currentLocationIfGranted", () => {
  test("never asks the browser for a position unless permission is already granted", async () => {
    for (const state of ["prompt", "denied"]) {
      const fake = deps(state);
      expect(await currentLocationIfGranted("adult", fake)).toBeUndefined();
      expect(fake.asked()).toBe(0);
    }
  });

  test("rounds to two decimals for an adult and a teen, one for a child", async () => {
    expect(await currentLocationIfGranted("adult", deps("granted"))).toEqual({ lat: 47.61, lon: -122.33 });
    expect(await currentLocationIfGranted("teen", deps("granted"))).toEqual({ lat: 47.61, lon: -122.33 });
    expect(await currentLocationIfGranted("child", deps("granted"))).toEqual({ lat: 47.6, lon: -122.3 });
  });

  test("a failing lookup answers nothing instead of throwing", async () => {
    const fake = deps("granted");
    fake.geolocation.getCurrentPosition = ((_: PositionCallback, reject?: PositionErrorCallback | null) => reject?.({ code: 3 } as GeolocationPositionError)) as never;
    expect(await currentLocationIfGranted("adult", fake)).toBeUndefined();
  });
});
