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
  expect(judgeCutIn("the dragon was nervous wait", said, false)).toBe("echo"); // the microphone check is too weak to trust on its own
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

test("the same stop word from a clearly louder source than her echo is a person even when her phrase has the word", () => {
  const now = "Oh, hold on, wait, the dragon had one more idea.";
  expect(judgeCutIn("Wait.", said + " " + now, true, now, true)).toBe("interrupt");
  expect(judgeCutIn("Wait.", said + " " + now, true, now, false)).toBe("echo");
});
import { judgeCutIn as jc } from "../src/selfEcho";
test("her own soft openers coming back are echo even when the mic looks louder (recorded self-stops of attempt 2: 'Hey,', 'Oh, hey.', 'So sorry.')", () => {
  expect(jc("Hey,", "Hey! I'm doing pretty well, thanks for asking.", false, "Hey! I'm doing pretty well, thanks for asking.", true)).toBe("echo");
  expect(jc("Oh, hey.", "Oh, hey! I'm doing pretty well, thanks for asking.", false, "Oh, hey! I'm doing pretty well, thanks for asking.", true)).toBe("echo");
  expect(jc("So sorry.", "Oh, I’m so sorry. That is just, really heavy.", false, "Oh, I’m so sorry. That is just, really heavy.", true)).toBe("echo");
});
test("a person saying wait or stop louder than her still stops her, even if she said the word too", () => {
  expect(jc("Wait.", "Wait, let me think about that for a second.", false, "Wait, let me think about that for a second.", true)).toBe("interrupt");
  expect(jc("Wait, stop.", "You got it. There was a dragon named", false, "You got it. There was a dragon named", true)).toBe("interrupt");
});
test("contractions and curly apostrophes are the same speech (recorded self-stops: I'm so sorry / that I'm sorry)", () => {
  expect(jc("I'm so sorry.", "[sigh]\nOh, I am so sorry. That is a real", false, "[sigh]\nOh, I am so sorry. That is a real", true)).toBe("echo");
  expect(jc("that I'm sorry.", "Oh, just that I’m sorry *you’re* the one", false, "Oh, just that I’m sorry *you’re* the one", true)).toBe("echo");
  expect(jc("Wait, stop.", "Oh, I’m so sorry you’re hurting", false, "Oh, I’m so sorry you’re hurting", true)).toBe("interrupt");
});
import { sustainedNewWords as snw, residualContent as rc } from "../src/selfEcho";
test("a person talking over her with a new sentence is recognised from the words that pile up, even when no single window counts (recorded: the story request over 'Aw, you’re the one who lost the dog')", () => {
  const spoken = "Aw, you’re the one who lost the dog, so... I’m sorry *you’re* the one saying sorry. But yeah, it’s a heavy kind of quiet";
  const heard = ["Can you tell me?", "Tell me along.", "Long story.", "story about", "about a drag", "Dragon who", "And who thinks?", "Baked bread."]; const h: any[] = []; let t = 0; let res: any = { interrupt: false };
  for (const w of heard) res = snw(h, (t += 350), rc(w, spoken));
  expect(res.interrupt).toBe(true);
});
test("her own garbled echo (one or two odd words per window) does not add up to an interruption", () => {
  const spoken = "Once upon a time, in a cave filled with embers, there was a dragon named Barnaby who had a secret obsession with baking bread";
  const heard = ["Once upon a", "in a cave.", "cave filled with", "with embers.", "They", "There was a", "was a dragon.", "Dragon named", "named Barnaby", "who had a C.", "a secret of", "Great obsession."]; const h: any[] = []; let t = 0; let res: any = { interrupt: false };
  for (const w of heard) res = snw(h, (t += 380), rc(w, spoken));
  expect(res.interrupt).toBe(false);
});
import { isOwnEchoTurn as echoTurn } from "../src/selfEcho";
const T0 = 100_000;
test("her own words committed as a user turn are dropped (recorded: 'I'm so sorry.', 'that I'm sorry you're')", () => {
  expect(echoTurn({ transcript: "I'm so sorry.", spoken: "[sigh]\nOh, I am so sorry. That is a real loss.", speechStartMs: T0 - 500, lastSpokeMs: T0, nowMs: T0 + 600 }).drop).toBe(true);
  expect(echoTurn({ transcript: "that I'm sorry you're", spoken: "Oh, just that I’m sorry *you’re* the one saying sorry.", speechStartMs: T0 - 300, lastSpokeMs: T0, nowMs: T0 + 800 }).drop).toBe(true);
});
test("a real new turn is not dropped, and neither is the person repeating her last sentence after she stopped for more than a second", () => {
  expect(echoTurn({ transcript: "Wait, stop. Sorry about that. What were you going to say?", spoken: "Oh, I am so sorry. That is a real loss.", speechStartMs: T0 - 200, lastSpokeMs: T0, nowMs: T0 + 900 }).drop).toBe(false);
  expect(echoTurn({ transcript: "Oh, I am so sorry.", spoken: "Oh, I am so sorry. That is a real loss.", speechStartMs: T0 + 2000, lastSpokeMs: T0, nowMs: T0 + 3500 }).drop).toBe(false);   // she was quiet for 2 s, then the person repeats her
  expect(echoTurn({ transcript: "I'm so sorry.", spoken: "Oh, I am so sorry.", speechStartMs: T0 - 300, lastSpokeMs: T0 - 15_000, nowMs: T0 }).drop).toBe(false);                       // she spoke more than 10 s ago
});
