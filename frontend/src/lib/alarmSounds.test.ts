import { describe, expect, test } from "bun:test";
import { ALARM_SOUNDS, ALARM_VOLUME_GAIN, alarmSoundNotes } from "@/lib/alarmSounds";

describe("alarm sound patterns", () => {
  test("has six distinct sounds, with None silent and every pattern inside the two minute cap", () => {
    expect(ALARM_SOUNDS).toHaveLength(6);
    expect(alarmSoundNotes("none")).toEqual([]);
    const lists = ALARM_SOUNDS.filter((sound) => sound.id !== "none").map((sound) => {
      expect(sound.notes.length).toBeGreaterThan(0);
      expect(sound.notes.every((note) => note.start >= 0 && note.duration > 0 && note.start + note.duration <= 120_000)).toBe(true);
      return JSON.stringify(sound.notes);
    });
    expect(new Set(lists).size).toBe(lists.length);
  });

  test("maps the three volume levels to the specified gains", () => {
    expect(ALARM_VOLUME_GAIN).toEqual({ low: 0.25, medium: 0.5, high: 0.9 });
  });
});
