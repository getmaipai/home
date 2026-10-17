// MUSIC-GEN-06 regression (found end to end on the Studio): asked to "change the chorus to be about waffles", the chat model
// sent the whole revised song (verse and chorus tags) as `lyrics` with `section: "chorus"`. Splicing that into the chorus
// put the verse inside the chorus. A whole song replaces the words; a bare fragment still replaces only its section.
import { expect, test } from "bun:test";
import { prepareMusicEdit } from "@/lib/music/tool";
import type { MusicJob } from "@/lib/music/types";

const STORED = "[Verse]\nMorning light on the kitchen floor\nCoffee steam and an open door\n\n[Chorus]\nSing it loud, pancakes\nSing it true, pancakes";
const LRC = "[00:00.00][Verse]\n[00:00.24]Morning light on the kitchen floor\n[00:06.00]Coffee steam and an open door\n[00:12.00][Chorus]\n[00:12.30]Sing it loud, pancakes\n[00:18.00]Sing it true, pancakes";
const source = { id: "mus-test0001", request: { description: "folk", lyrics: STORED, seconds: 30, instrumental: false, seed: 5 }, durationS: 30, seed: 5, lrc: LRC, fileId: "file-test0001" } as unknown as MusicJob;

test("a whole revised song sent for one section replaces the words without duplicating the verse", () => {
  const whole = STORED.replace(/pancakes/g, "waffles");
  const plan = prepareMusicEdit(source, { track: "latest", change: "rewrite_section", section: "chorus", lyrics: whole } as never);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.request.lyrics).toBe(whole);
  expect(plan.request.lyrics!.match(/\[Verse\]/g)!.length).toBe(1);
  expect(plan.request.from_s).toBeGreaterThanOrEqual(11);
});

test("a bare fragment still replaces only the named section", () => {
  const plan = prepareMusicEdit(source, { track: "latest", change: "rewrite_section", section: "chorus", lyrics: "Sing it loud, waffles\nSing it true, waffles" } as never);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.request.lyrics).toContain("[Verse]\nMorning light");
  expect(plan.request.lyrics).toContain("[Chorus]\nSing it loud, waffles");
  expect(plan.request.lyrics).not.toContain("pancakes");
});
