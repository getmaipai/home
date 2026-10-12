// IMG-REPLY-LEAK-01: the show_images result line tells the model not to call the
// tool again or echo its arguments (subject, kind) in the written reply.
import { expect, test } from "bun:test";
import { showImagesMultiResultLine, showImagesResultLine } from "@/lib/answerImages/turn";

test("the show_images result line forbids calling it again and echoing its subject or kind", () => {
  const line = showImagesResultLine("a red fox");
  expect(line).toContain("Photos of a red fox are on their screen.");
  expect(line).toContain("Do not call show_images again or write its subject or kind in your reply.");
});

// SEARCH-IMAGES-02: a `subjects` call says pictures appear only where one was found.
test("the multi-subject result line says a picture shows only for names where one was found", () => {
  const line = showImagesMultiResultLine(["Eiffel Tower", "Statue of Liberty", "Nobody Atall"]);
  expect(line).toContain("Photos of Eiffel Tower, Statue of Liberty, Nobody Atall may be on their screen.");
  expect(line).toContain("A picture shows only for each name where one was found; a name with no picture shows nothing");
  expect(line).toContain("never promise one for every name.");
  expect(line).toContain("Do not call show_images again or write its subjects or kind in your reply.");
  expect(line).not.toContain("are on their screen");
  expect(line).not.toContain("—");
});
