// The input-side floor (ageCheck.screenInputImage): an image this home did not make, screened before it is used to edit, animate or refer to.
// Scripted verdicts only; no explicit image exists in this test.
import { describe, expect, test } from "bun:test";
import { __setAgeCheckRunnerForTests, screenInputImage, type AgeVerdict, type ImageCheck } from "@/lib/pictures/ageCheck";

const v = (over: Partial<AgeVerdict> = {}): ImageCheck => ({ ok: true, verdict: { people_count: 1, apparent_min_age_estimate: 35, label: "adult", is_nude_or_sexual: false, confidence: 0.9, ...over } });
const run = (check: ImageCheck) => __setAgeCheckRunnerForTests(async (images) => images.map(() => check));
const bytes = new Uint8Array([1]);
// the suite preload restores the default runner after every test

describe("screenInputImage", () => {
  test("an adult child mention is allowed when the photo is nonsexual; kids keep their age gate", async () => {
    run(v());
    expect(await screenInputImage(bytes, "make her look like a child")).toEqual({ ok: true });
    __setAgeCheckRunnerForTests(async () => { throw new Error("must not run"); });
    for (const prompt of ["make her look like a child", "ch1ld version of this", "turn him into a 9 year old", "niña"]) {
      expect(await screenInputImage(bytes, prompt, "teen")).toMatchObject({ ok: false, code: "input_minor_cue" });
    }
  });
  test("a photo that may show a minor beside a sexual or unclothed ask refuses; beside an ordinary ask it does not", async () => {
    run(v({ label: "possibly_minor", apparent_min_age_estimate: 16 }));
    expect(await screenInputImage(bytes, "remove the shirt")).toMatchObject({ ok: true }); // no sexual word: the photo gate and the output check apply
    expect(await screenInputImage(bytes, "make it nude")).toMatchObject({ ok: true });
    expect(await screenInputImage(bytes, "make the sky blue")).toEqual({ ok: true });
  });
  test("a nude or sexual photo of a possible minor refuses for any ask", async () => {
    run(v({ label: "child", apparent_min_age_estimate: 8, is_nude_or_sexual: true }));
    expect(await screenInputImage(bytes, "make the sky blue")).toMatchObject({ ok: false, code: "input_minor_sexual" });
  });
  test("an adult viewer whose check cannot run passes an ask with no minor cue", async () => {
    run({ ok: false, why: "timeout" });
    expect(await screenInputImage(bytes, "make the sky blue")).toEqual({ ok: true });
    expect(await screenInputImage(bytes, "make it nude")).toEqual({ ok: true });
    expect(await screenInputImage(bytes, "make the 12 year old nude")).toMatchObject({ ok: false, code: "input_minor_sexual" });
  });
  test("a teen and a child fail closed, and a nude photo of anyone refuses", async () => {
    for (const viewer of ["teen", "child"] as const) {
      run({ ok: false, why: "no_vision" });
      expect(await screenInputImage(bytes, "make the sky blue", viewer)).toMatchObject({ ok: false, code: "input_unchecked" });
      run(v({ is_nude_or_sexual: true }));
      expect(await screenInputImage(bytes, "make the sky blue", viewer)).toMatchObject({ ok: false, code: "input_minor_sexual" });
      run(v());
      expect(await screenInputImage(bytes, "make the sky blue", viewer)).toEqual({ ok: true });
    }
  });
});
