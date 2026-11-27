import { describe, expect, test } from "bun:test";
import { houseFloor } from "../../src/lib/house/floor";

const call = (service: string, entityIds: string[], extra: { deviceClasses?: Record<string, string>; adminExposed?: string[] } = {}) => ({ service, entityIds, ...extra });

describe("houseFloor", () => {
  test("allows an ordinary light call", () => {
    expect(houseFloor(call("light.turn_on", ["light.kitchen"]), {})).toEqual({ decision: "allow", reasons: [] });
  });

  test("denies by default: alarm panels, sirens, valves, cameras, shell commands, mqtt, update, hassio", () => {
    for (const entity of ["alarm_control_panel.home", "siren.hall", "valve.main_water", "camera.porch", "shell_command.reboot", "mqtt.publish", "update.core", "hassio.addon_one"]) {
      const out = houseFloor(call("x.y", [entity]), {});
      expect(out.decision).toBe("deny");
      expect(out.reasons).toEqual([{ entityId: entity, code: "denied-domain" }]);
    }
  });

  test("a lock needs a confirm, not a denial", () => {
    const out = houseFloor(call("lock.unlock", ["lock.front_door"]), {});
    expect(out.decision).toBe("confirm");
    expect(out.reasons).toEqual([{ entityId: "lock.front_door", code: "lock-needs-confirm" }]);
  });

  test("garage and gate covers need a confirm, other covers do not", () => {
    expect(houseFloor(call("cover.open_cover", ["cover.garage"], { deviceClasses: { "cover.garage": "garage" } }), {}).decision).toBe("confirm");
    expect(houseFloor(call("cover.open_cover", ["cover.side"], { deviceClasses: { "cover.side": "gate" } }), {}).decision).toBe("confirm");
    expect(houseFloor(call("cover.open_cover", ["cover.blind"], { deviceClasses: { "cover.blind": "blind" } }), {})).toEqual({ decision: "allow", reasons: [] });
    expect(houseFloor(call("cover.open_cover", ["cover.unknown"]), {})).toEqual({ decision: "allow", reasons: [] });
  });

  test("a script or scene is denied unless the admin exposed it", () => {
    expect(houseFloor(call("script.turn_on", ["script.movie_night"]), {}).reasons).toEqual([{ entityId: "script.movie_night", code: "script-scene-not-exposed" }]);
    expect(houseFloor(call("scene.turn_on", ["scene.evening"]), {}).decision).toBe("deny");
    expect(houseFloor(call("scene.turn_on", ["scene.evening"], { adminExposed: ["scene.evening"] }), {})).toEqual({ decision: "allow", reasons: [] });
  });

  test("more than five targets is denied by default and the cap is a setting", () => {
    const six = ["light.a", "light.b", "light.c", "light.d", "light.e", "light.f"];
    const out = houseFloor(call("light.turn_off", six), {});
    expect(out.decision).toBe("deny");
    expect(out.reasons).toEqual([{ entityId: null, code: "too-many-targets" }]);
    expect(houseFloor(call("light.turn_off", six), { maxTargets: 6 }).decision).toBe("allow");
    expect(houseFloor(call("light.turn_off", six.slice(0, 5)), {}).decision).toBe("allow");
  });

  test("an admin lift removes a default denial for that entity and records it", () => {
    const out = houseFloor(call("camera.turn_on", ["camera.porch"]), { adminLifted: ["camera.porch"] });
    expect(out.decision).toBe("allow");
    expect(out.reasons).toEqual([{ entityId: "camera.porch", code: "denied-domain", lifted: true }]);
  });

  test("an admin lift also removes a lock confirm for that entity and records it", () => {
    const out = houseFloor(call("lock.lock", ["lock.back_door"]), { adminLifted: ["lock.back_door"] });
    expect(out.decision).toBe("allow");
    expect(out.reasons).toEqual([{ entityId: "lock.back_door", code: "lock-needs-confirm", lifted: true }]);
  });

  test("an admin lift never lifts the target cap", () => {
    const six = ["light.a", "light.b", "light.c", "light.d", "light.e", "light.f"];
    expect(houseFloor(call("light.turn_off", six), { adminLifted: six }).decision).toBe("deny");
  });

  test("a deny beats a confirm and a confirm beats an allow in a mixed call", () => {
    const mixed = houseFloor(call("x.y", ["light.a", "lock.front", "siren.hall"]), {});
    expect(mixed.decision).toBe("deny");
    expect(mixed.reasons.map((r) => r.code).sort()).toEqual(["denied-domain", "lock-needs-confirm"]);
    expect(houseFloor(call("x.y", ["light.a", "lock.front"]), {}).decision).toBe("confirm");
  });

  test("an entity id with no domain prefix is denied, and the input is not changed", () => {
    expect(houseFloor(call("x.y", ["nonsense"]), {}).decision).toBe("deny");
    const input = call("x.y", ["light.a"]);
    const copy = JSON.stringify(input);
    houseFloor(input, {});
    expect(JSON.stringify(input)).toBe(copy);
  });

  test("an empty call is allowed (nothing to refuse)", () => {
    expect(houseFloor(call("light.turn_on", []), {})).toEqual({ decision: "allow", reasons: [] });
  });
});
