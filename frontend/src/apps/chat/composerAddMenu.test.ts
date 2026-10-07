import { describe, expect, test } from "bun:test";
import { attachmentAddErrorMessage } from "@/apps/chat/composerAddMenu";

// UPLOAD-IMG-02: a refused file is reported by assistant-ui as an event, not
// a tile. Each refusal becomes one plain line a parent understands, never
// the runtime's own "File type ... is not accepted. Accepted types: ..." text.
describe("attachmentAddErrorMessage", () => {
  test("a pasted or dropped picture for a child with photos off says photos are off", () => {
    expect(attachmentAddErrorMessage({ reason: "not-accepted", message: "File type image/png is not accepted. Accepted types: .pdf", contentType: "image/png" }, false)).toBe("Photo uploads are turned off for this profile.");
  });

  test("a permitted photo is refused with the live-model reason while picture input is unavailable", () => {
    expect(attachmentAddErrorMessage({ reason: "not-accepted", message: "File type image/png is not accepted. Accepted types: .pdf", contentType: "image/png" }, true, false)).toBe("Pictures need a ready vision model.");
  });

  test("an unsupported file type gets a plain line, not the accept list", () => {
    const line = attachmentAddErrorMessage({ reason: "not-accepted", message: "File type application/zip is not accepted. Accepted types: image/*,.pdf", contentType: "application/zip" }, true);
    expect(line).toBe("That kind of file can't be added here.");
    expect(line).not.toContain("Accepted types");
  });

  test("the adapter's own plain refusal (a fifth picture, a 12 MB picture) is shown as written", () => {
    expect(attachmentAddErrorMessage({ reason: "adapter-error", message: "You can add up to 4 pictures, each up to 10 MB.", contentType: "image/jpeg" }, true)).toBe("You can add up to 4 pictures, each up to 10 MB.");
  });
});
