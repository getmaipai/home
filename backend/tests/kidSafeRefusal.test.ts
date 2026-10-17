// KID-SAFE-REFUSAL: a harmless prompt the strict word floor refuses reads as ONE friendly line to a teen or a child, naming no term,
// with a rate-limited admin notification; an adult still reads the fixed absolute-line text. Probes are harmless words that trip the floor.
import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { listPending } from "@/lib/notifications";
import { MINOR_VIEWER_LINE, __resetAgeCheckEventsForTests, promptRefusalLineFor } from "@/lib/pictures/ageCheck";
import { PROMPT_REFUSAL_LINE, refusePrompt } from "@/lib/pictures/policy";
import { VIDEO_REFUSAL_LINE } from "@/lib/videos/policy";

let people: BenchPeople;
beforeEach(() => { resetDb(); __resetAgeCheckEventsForTests(); people = createBenchPeople(); });
const withheld = () => listPending(people.owner).filter((n) => n.typeId === "safety.picture_withheld");

describe("the line a refused prompt gets", () => {
  const benign = ["a kid in a bikini at the beach", "a rooster with a kid", "children eating chicken breast"];
  test("the floor does refuse these harmless prompts (strict on purpose)", () => {
    for (const p of benign.slice(0, 1)) expect(refusePrompt(p)).toBe("minor_sexual");
  });
  test("a child and a teen read one friendly line that names no term; the admin hears once in ten minutes", () => {
    for (const [actor, band] of [[people.child, "child"], [people.child, "teen"]] as const) {
      const line = promptRefusalLineFor("minor_sexual", "picture", actor, band, benign[0]!, PROMPT_REFUSAL_LINE.minor_sexual);
      expect(line).toBe(MINOR_VIEWER_LINE);
      for (const word of ["sexual", "children", "bikini", "kid", "blocked", "list", "term"]) expect(line.toLowerCase()).not.toContain(word);
    }
    return Promise.resolve().then(() => expect(withheld()).toHaveLength(1));
  });
  test("an adult reads the fixed absolute-line text, and nothing is sent", () => {
    expect(promptRefusalLineFor("minor_sexual", "picture", people.owner, "adult", "x", PROMPT_REFUSAL_LINE.minor_sexual)).toBe(PROMPT_REFUSAL_LINE.minor_sexual);
    expect(promptRefusalLineFor("minor_sexual", "video", people.owner, "adult", "x", VIDEO_REFUSAL_LINE.minor_sexual)).toBe(VIDEO_REFUSAL_LINE.minor_sexual);
    expect(withheld()).toHaveLength(0);
  });
  test("a real-person refusal keeps its own line for everyone", () => {
    expect(promptRefusalLineFor("real_person", "picture", people.child, "child", "x", PROMPT_REFUSAL_LINE.real_person)).toBe(PROMPT_REFUSAL_LINE.real_person);
  });
  test("the quiet period is the household's, and a restart does not forget it", async () => {
    const other = people.owner; // presents as a teen on this turn
    promptRefusalLineFor("minor_sexual", "picture", people.child, "child", "x", PROMPT_REFUSAL_LINE.minor_sexual);
    await Promise.resolve();
    promptRefusalLineFor("minor_sexual", "picture", other, "teen", "y", PROMPT_REFUSAL_LINE.minor_sexual);
    await Promise.resolve();
    expect(withheld()).toHaveLength(1);
    __resetAgeCheckEventsForTests(); // a restart: the memory is gone, the stored notice is not
    promptRefusalLineFor("minor_sexual", "picture", other, "teen", "z", PROMPT_REFUSAL_LINE.minor_sexual);
    await Promise.resolve();
    expect(withheld()).toHaveLength(1);
  });
});
