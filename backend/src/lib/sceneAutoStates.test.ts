import { afterEach, describe, expect, test } from "bun:test";
import { noteNowPlaying, clearNowPlaying, __resetHeardSongsForTests } from "@/lib/music/heardSong";
import { __resetSceneAutoStatesForTests, automaticStates, mediaPlaying, notableToNotificationOnly, offersAllowed, setCallInProgress, soundThresholdFor } from "@/lib/sceneAutoStates";

afterEach(() => { __resetSceneAutoStatesForTests(); __resetHeardSongsForTests(); });

describe("automatic scene states", () => {
  test("playback starts, runs, stops and expires after two minutes", () => {
    expect(mediaPlaying("device-a", 1000)).toBe(false);
    noteNowPlaying("device-a", { title: "private title" }, 2000);
    expect(mediaPlaying("device-a", 2000)).toBe(true);
    clearNowPlaying("device-a");
    expect(mediaPlaying("device-a", 3000)).toBe(true);
    expect(mediaPlaying("device-a", 123_000)).toBe(false);
  });
  test("music, breaking glass, shouting, sensor and emergency classes respect media rules", () => {
    noteNowPlaying("device-a", { title: "private title" }, 1000);
    expect(soundThresholdFor("music_or_tv", "device-a", null, 1001)).toBe("ignore");
    expect(soundThresholdFor("glass_breaking", "device-a", null, 1001)).toBe("normal");
    expect(soundThresholdFor("shouting", "device-a", null, 1001)).toBe("raised");
    for (const kind of ["smoke_alarm", "co_alarm", "siren", "smoke", "co", "gas", "leak", "temperature", "alarm_panel", "motion", "door", "water"]) {
      expect(soundThresholdFor(kind, "device-a", "opaque-room", 1001)).toBe("normal");
    }
  });
  test("call holds offers only on its device", () => {
    setCallInProgress("device-a", true);
    expect(offersAllowed("device-a")).toBe(false);
    expect(offersAllowed("device-b")).toBe(true);
  });
  test("quiet hours and own away place are notification only", () => {
    expect(notableToNotificationOnly("away", 0)).toBe(true);
    expect(notableToNotificationOnly("home", 0)).toBe(false);
  });
  test("derived state contains only active state names", () => {
    noteNowPlaying("device-a", { title: "private title" }, 1000);
    setCallInProgress("device-a", true);
    expect([...automaticStates({ deviceId: "device-a", ownPlace: "away", now: 1001 })].sort()).toEqual((["away", "call_in_progress", "media_playing"] as const).slice().sort());
  });
});
