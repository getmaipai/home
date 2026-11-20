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

test("one or two stray words, such as half a name from her own voice, never stop her", () => {
  expect(judgeCutIn("Ignati", said)).toBe("echo");
  expect(judgeCutIn("map massive", said)).toBe("echo");
  expect(judgeCutIn("no way", said)).toBe("ack"); // a reaction, not a stop
});

test("function words and a half-heard run of her own story never count as a person talking", () => {
  expect(judgeCutIn("But while there was a", said)).toBe("echo");
  expect(judgeCutIn("He wants to be a good idea", said + " He wants to be a good idea, I guess.")).toBe("echo");
  expect(judgeCutIn("Everyone was afraid of the", said)).toBe("echo");
});

test("a stop word in the middle of her own blurred sentence is not a command, one at the start is", () => {
  expect(judgeCutIn("you want to hold", said)).toBe("echo");
  expect(judgeCutIn("No, I usually keep", said)).toBe("echo");
  expect(judgeCutIn("please stop", said)).toBe("interrupt");
  expect(judgeCutIn("hold on a second", said)).toBe("interrupt");
});

test("a lone late stop word counts only when the microphone does not look like her own voice", () => {
  expect(judgeCutIn("you want to hold", said, true)).toBe("echo");
  expect(judgeCutIn("the dragon was nervous wait", said, false)).toBe("interrupt");
  expect(judgeCutIn("the dragon was nervous wait", said, true)).toBe("echo");
  expect(judgeCutIn("the dragon was nervous wait stop", said, true)).toBe("interrupt");
});

test("a short utterance with a stop word is a command even when her own story used the same words", () => {
  const story = said + " Wait, stop, said the baker.";
  expect(judgeCutIn("Wait, stop.", story, true, "the first loaf was a disaster")).toBe("interrupt");
  expect(judgeCutIn("Stop.", story, true, "the first loaf was a disaster")).toBe("interrupt");
});

test("her own \"hold on\" from the phrase playing right now is echo; the same words from a person are a command", () => {
  const now = "Oh, hold on, wait, the dragon had one more idea.";
  expect(judgeCutIn("Hold on.", said + " " + now, true, now)).toBe("echo");
  expect(judgeCutIn("Wait.", said + " " + now, true, now)).toBe("echo");
  expect(judgeCutIn("Hold on.", said, true, said)).toBe("interrupt");
});
