import { describe, expect, test } from "bun:test";
import { canRestartServer, houseAccess, visibleEntities, type EffectivePermission, type HouseActor } from "../../src/lib/house/access.js";
import type { HouseEntity } from "../../src/lib/house/registry.js";

const light: HouseEntity = { id: "light.kitchen_ceiling", area: "kitchen", kind: "light", sensitive: null, name: "", state: "off", deviceClass: null, rgb: null, brightness: null, sceneMembers: null };
const lock: HouseEntity = { ...light, id: "lock.front_door", kind: "lock", sensitive: "lock" };
const camera: HouseEntity = { ...light, id: "camera.driveway", kind: "camera", sensitive: "camera" };
const scene: HouseEntity = { ...light, id: "scene.evening", kind: "scene", sceneMembers: [light.id] };
const actor = (role: HouseActor["role"], band: HouseActor["band"], id = "person-1"): HouseActor => ({ role, band, id });
const grant = (action: string, effect: EffectivePermission["effect"] = "allow"): EffectivePermission => ({ action, effect });
const access = (who: HouseActor, entity: HouseEntity, permissions: EffectivePermission[] = [], level: "see" | "control" | "confirm" = "control") => houseAccess({ actor: who, permissions, entity, level });

describe("house access", () => {
  test("unknown speakers cannot see, control, or confirm", () => {
    for (const level of ["see", "control", "confirm"] as const) {
      expect(access(actor("guest", "adult"), light, [grant(`house.${level}:entity:${light.id}`)], level).reason).toBe("unknown_speaker");
      expect(access(actor("unknown", "adult"), light, [], level).allowed).toBe(false);
      expect(access({ role: "adult", band: "adult" }, light, [], level).reason).toBe("unknown_speaker");
    }
  });

  test("area grants allow ordinary devices; sensitive policy stays above grants", () => {
    expect(access(actor("child", "child"), light, [grant("house.control:area:kitchen")]).allowed).toBe(true);
    expect(access(actor("child", "child"), lock, [grant(`house.control:entity:${lock.id}`)]).reason).toBe("never_for_band");
    expect(access(actor("child", "child"), camera, [grant(`house.see:entity:${camera.id}`)], "see").reason).toBe("never_for_band");
    expect(access(actor("teen", "teen"), lock, [grant(`house.control:entity:${lock.id}`)] )).toEqual({ allowed: true, confirm: true, reason: "granted" });
    expect(access(actor("teen", "teen"), lock).reason).toBe("no_grant");
  });

  test("deny wins at either specificity", () => {
    expect(access(actor("adult", "adult"), light, [grant(`house.control:entity:${light.id}`, "deny"), grant("house.control:area:kitchen")]).reason).toBe("denied");
    expect(access(actor("adult", "adult"), light, [grant("house.control:area:kitchen", "deny"), grant(`house.control:entity:${light.id}`)]).reason).toBe("denied");
  });

  test("owners need no grant but follow confirmation cells", () => {
    expect(access(actor("owner", "adult"), light)).toEqual({ allowed: true, confirm: false, reason: "owner" });
    expect(access(actor("owner", "adult"), lock)).toEqual({ allowed: true, confirm: true, reason: "owner" });
  });

  test("area grants do not extend to another area", () => {
    expect(access(actor("adult", "adult"), { ...light, area: "living_room" }, [grant("house.control:area:kitchen")]).reason).toBe("no_grant");
  });

  test("server restart is owner-only", () => {
    expect(canRestartServer(actor("owner", "adult"))).toBe(true);
    for (const role of ["admin", "adult", "teen", "child"] as const) expect(canRestartServer(actor(role, "adult"))).toBe(false);
  });

  test("visibleEntities filters by see permission and scenes use ordinary entity grants", () => {
    const entities = [light, lock, scene];
    expect(visibleEntities({ actor: actor("adult", "adult"), permissions: [grant(`house.see:entity:${light.id}`), grant(`house.see:entity:${scene.id}`)], entities, level: "see" })).toEqual([light, scene]);
    expect(access(actor("adult", "adult"), scene, [grant(`house.control:entity:${scene.id}`)])).toEqual({ allowed: true, confirm: false, reason: "granted" });
  });
});
