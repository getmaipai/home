// IMG-REPLY-LEAK-01: the show_images result line tells the model not to call the
// tool again or echo its arguments (subject, kind) in the written reply.
import { expect, test } from "bun:test";
import { showImagesEmptyResultLine, showImagesMultiResultLine, showImagesResultLine } from "@/lib/answerImages/turn";

test("the show_images result line forbids calling it again and echoing its subject or kind", () => {
  const line = showImagesResultLine("a red fox");
  expect(line).toContain("One picture of a red fox is on their screen.");
  expect(line).toContain("Do not call show_images again or write its subject or kind in your reply.");
});

test("an empty image result tells the model to say it could not show a picture and offer next steps", () => {
  const line = showImagesEmptyResultLine("Dune: Part Three");
  expect(line).toContain("No picture was found or passed the checks for Dune: Part Three.");
  expect(line.toLowerCase()).toContain("tell the person you could not show a poster");
  expect(line).toContain("offer to try again or open the Wikipedia page");
});

// SEARCH-IMAGES-02: a `subjects` call says pictures appear only where one was found.
test("the multi-subject result line names only pictures shown and says which names had no result", () => {
  const line = showImagesMultiResultLine(["Eiffel Tower", "Statue of Liberty"], ["Nobody Atall"]);
  expect(line).toContain("2 pictures of Eiffel Tower, Statue of Liberty are on their screen.");
  expect(line).toContain("No picture was found or passed the checks for Nobody Atall");
  expect(line).toContain("Do not call show_images again or write its subjects or kind in your reply.");
  expect(line).toContain("are on their screen");
});
