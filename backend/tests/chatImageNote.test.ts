import { describe, expect, test } from "bun:test";
import { cleanPictureName, pictureFailureWords, picturesAttachedNote, picturesWindowNote, storedImages } from "@/lib/chatImageNote";

const pic = (name: string, shown?: boolean) => ({ id: name, name, width: 1, height: 1, media_type: "image/png", ...(shown ? { shown_to_model: true } : {}) }) as never;

describe("chatImageNote", () => {
  test("picturesAttachedNote counts and names the pictures", () => {
    expect(picturesAttachedNote([pic("cat.png")])).toContain("The person attached 1 picture to this message: cat.png.");
    expect(picturesAttachedNote([pic("a.png"), pic("b.png")])).toContain("The person attached 2 pictures to this message: a.png, b.png.");
    expect(picturesAttachedNote([pic("cat.png")])).toContain("You cannot tell who a person in a photo is.");
  });
  test("picturesWindowNote separates shown and unseen pictures", () => {
    expect(picturesWindowNote([pic("a.png", true), pic("b.png")])).toBe(
      "[pictures shown to you with this message, not shown again: a.png] [pictures attached, not seen: b.png]",
    );
    expect(picturesWindowNote([pic("b.png")])).toBe("[pictures attached, not seen: b.png]");
    expect(picturesWindowNote([])).toBe("");
  });
  test("pictureFailureWords names each failure kind", () => {
    expect(pictureFailureWords("context_too_large")).toBe("it did not fit in the conversation");
    expect(pictureFailureWords("slow")).toBe("it took too long to read");
    expect(pictureFailureWords("anything else")).toBe("the picture reader could not take it");
  });
  test("storedImages keeps only items with a string name", () => {
    expect(storedImages('[{"name":"a.png"},{"id":1},null]')).toEqual([{ name: "a.png" } as never]);
  });
  test("storedImages returns an empty list for missing or broken input", () => {
    expect(storedImages(null)).toEqual([]);
    expect(storedImages("")).toEqual([]);
    expect(storedImages("not json")).toEqual([]);
    expect(storedImages('{"name":"a.png"}')).toEqual([]);
  });
  test("cleanPictureName flattens newlines and falls back to picture", () => {
    expect(cleanPictureName("cat\nphoto.png")).toBe("cat photo.png");
    expect(cleanPictureName("  \n")).toBe("picture");
  });
});
