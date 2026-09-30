import { describe, expect, test } from "bun:test";
import { enrollmentSoundsEnabled, soundsFromQuery } from "./enrollmentSoundsSetting";

describe("soundsFromQuery", () => {
  test("waits (null) while the settings have not answered", () => {
    expect(soundsFromQuery(undefined, false)).toBe(null);
  });

  test("a failed first read counts as on, the key's default", () => {
    expect(soundsFromQuery(undefined, true)).toBe(true);
  });

  test("a failed refetch never overrides a stored off", () => {
    expect(soundsFromQuery([{ key: "ui.enrollment_sounds", value: false }], true)).toBe(false);
  });
});

describe("enrollmentSoundsEnabled", () => {
  test("is on when the person never set it (the key's own default)", () => {
    expect(enrollmentSoundsEnabled([])).toBe(true);
    expect(enrollmentSoundsEnabled([{ key: "ui.appearance", value: "dark" }])).toBe(true);
  });

  test("follows the stored value", () => {
    expect(enrollmentSoundsEnabled([{ key: "ui.enrollment_sounds", value: false }])).toBe(false);
    expect(enrollmentSoundsEnabled([{ key: "ui.enrollment_sounds", value: true }])).toBe(true);
  });

  test("a stored value that is not a boolean falls back to on", () => {
    expect(enrollmentSoundsEnabled([{ key: "ui.enrollment_sounds", value: "off" }])).toBe(true);
  });
});
