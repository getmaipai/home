import { expect, test } from "bun:test";
import { judgeCutIn } from "../src/selfEcho";

const said = "Oh, I think the dragon was honestly a little nervous about the bread, you know, the first loaf was a disaster.";
test("her own words coming back through the microphone never stop her", () => {
  expect(judgeCutIn("the dragon was honestly a little nervous about the bread", said)).toBe("echo");
  expect(judgeCutIn("the dragon was honestly a little nervus about the bred you know", said)).toBe("echo"); // recognizer misspells her
  expect(judgeCutIn("I think the first loaf was a disaster", said)).toBe("echo");
});
test("a person over her voice still stops her", () => {
  expect(judgeCutIn("wait stop", said)).toBe("interrupt");
  expect(judgeCutIn("wait stop the dragon was honestly a little nervous", said)).toBe("interrupt");
  expect(judgeCutIn("actually I wanted to ask about something else entirely", said)).toBe("interrupt");
});
test("mm-hm and yeah keep her going, with or without echo mixed in", () => {
  expect(judgeCutIn("mm-hm", said)).toBe("ack");
  expect(["ack", "echo"]).toContain(judgeCutIn("yeah the dragon was honestly a little nervous", said));
});
test("nothing recognised is unknown, not an interruption", () => { expect(judgeCutIn("", said)).toBe("unknown"); });
