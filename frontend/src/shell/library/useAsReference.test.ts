import { describe, expect, test } from "bun:test";
import { referenceHandoff, REFERENCES_FULL_LINE } from "./useAsReference";

describe("referenceHandoff", () => {
  test("a first picture becomes the reference", () => {
    expect(referenceHandoff("pic-1")).toEqual({ ok: true, to: "/apps/image/create", state: { pageState: { reference: "pic-1" } } });
  });
  test("a chosen reference is kept and the new one is added", () => {
    expect(referenceHandoff("pic-3", "pic-1,pic-2")).toMatchObject({ ok: true, state: { pageState: { reference: "pic-1,pic-2,pic-3" } } });
  });
  test("a picture already chosen is not added twice", () => {
    expect(referenceHandoff("pic-2", "pic-1,pic-2")).toMatchObject({ ok: true, state: { pageState: { reference: "pic-1,pic-2" } } });
  });
  test("at three the answer is one plain line", () => {
    expect(referenceHandoff("pic-4", "pic-1,pic-2,pic-3")).toEqual({ ok: false, line: REFERENCES_FULL_LINE });
    expect(REFERENCES_FULL_LINE).toBe("The reference slot already holds 3 pictures. Remove one first.");
  });
});
