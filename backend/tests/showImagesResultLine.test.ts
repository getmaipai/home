// IMG-REPLY-LEAK-01: the show_images result line tells the model not to call the
// tool again or echo its arguments (subject, kind) in the written reply.
import { expect, test } from "bun:test";
import { showImagesResultLine } from "@/lib/answerImages/turn";

test("the show_images result line forbids calling it again and echoing its subject or kind", () => {
  const line = showImagesResultLine("a red fox");
  expect(line).toContain("Photos of a red fox are on their screen.");
  expect(line).toContain("Do not call show_images again or write its subject or kind in your reply.");
});
