import { expect, test } from "bun:test";
import { MoodPolicy } from "../src/moodPolicy";
const ok = (p: MoodPolicy, tag: string) => p.check(tag).ok;
const turn = (p: MoodPolicy, say: string, tag?: string) => { p.beginReply(say); const r = tag ? p.check(tag) : { ok: true }; p.finishReply(); return r; };
test("no mood on the first reply of a conversation", () => { const p = new MoodPolicy(); p.beginReply("Hi there"); const r = p.check("whisper"); expect(r.ok).toBe(false); expect((r as any).reason).toContain("first reply"); });
test("whisper only if the person asked for it", () => {
  const p = new MoodPolicy(); turn(p, "Hello"); turn(p, "Tell me a joke"); turn(p, "And another"); turn(p, "Okay"); turn(p, "Thanks");
  p.beginReply("Tell me a secret"); expect(ok(p, "whisper")).toBe(false); p.finishReply();
  for (let i = 0; i < 4; i++) turn(p, "go on");
  p.beginReply("Can you whisper that to me?"); expect(ok(p, "whisper")).toBe(true);
});
test("a mood is never chosen in response to a comment about the voice (recorded: 'why are you whispering')", () => {
  const p = new MoodPolicy(); for (let i = 0; i < 6; i++) turn(p, "chat " + i);
  for (const say of ["Why are you whispering?", "You sound weird", "why do you sound so tired", "Talk normal please"]) { p.beginReply(say); const r = p.check("excited"); expect(r.ok).toBe(false); expect((r as any).reason).toContain("voice itself"); p.finishReply(); }
});
test("at most one mood in any 4 replies: after a mood reply the next three are normal", () => {
  const p = new MoodPolicy(); for (let i = 0; i < 3; i++) turn(p, "chat " + i);
  expect(turn(p, "I got the job!", "excited").ok).toBe(true);
  for (let i = 0; i < 3; i++) { const r = turn(p, "and then " + i, "sad"); expect(r.ok).toBe(false); }
  expect(turn(p, "later on", "sad").ok).toBe(true);
});
test("later tags in the same reply follow the first decision, and a suppressed reply does not start the cooldown", () => {
  const p = new MoodPolicy(); p.beginReply("hi"); expect(p.check("excited").ok).toBe(false); expect(p.check("sad").ok).toBe(false); p.finishReply();
  p.beginReply("I won a prize!"); expect(p.check("excited").ok).toBe(true); expect(p.check("sad").ok).toBe(true);
});
import { defaultSettings } from "../src/voiceSettings";
test("mood sample switching is off by default (owner's blind verdict: mild happy and blend 'crazy emotion, awful')", () => { expect(Bun.env.LAB_MOOD_STRENGTH ?? "off").toBe(defaultSettings().moodStrength); });
