// Mood policy, in code (the prompt only asks): the model's first reply of a conversation, a reply to a comment about the voice itself, a whisper nobody asked for, and moods in quick succession are all suppressed.
// Recorded (the owner's live test): the model chose [whisper] on its first reply, then reacted to "why are you whispering" with an exaggerated excited voice, then a sigh, before a normal reply.
export const MOOD_TAGS = ["whisper", "shout", "angry", "excited", "happy", "sad", "sarcastic"] as const;
/** At most one mood in any 4 replies: after a mood reply the next 3 are normal. */
export const MOOD_COOLDOWN_REPLIES = 3;
const askedWhisper = /\b(whisper|whispering|quietly|quiet voice|softly|in a (low|soft|hushed) voice|hushed|shh+)\b/i;
const voiceComment = /\b(why (are|were|do|did) you (whisper\w*|shout\w*|yell\w*|talk\w*|speak\w*|sound\w*|say it)|you sound|your voice|that voice|this voice|why so|stop (whisper\w*|shout\w*|yell\w*|talking like)|talk normal|normal voice|sound(ing)? (weird|strange|odd|different|funny|tired|sleepy|sad|angry|excited)|are you (ok|okay|tired|sleepy|mad|sick)|too (loud|quiet|soft))\b/i;
export type MoodVerdict = { ok: true } | { ok: false; reason: string };
export class MoodPolicy {
  private replies = 0; private lastMoodReply = -1e9; private userText = ""; private suppressed = false; private used = false;
  /** Start of one reply attempt: what the person just said. */
  beginReply(userText: string) { this.userText = userText; this.suppressed = false; this.used = false; }
  /** The model wrote a mood tag in the current reply: may it take effect? Decided once per reply; later tags in the same reply follow the same answer. */
  check(tag: string): MoodVerdict {
    if (this.suppressed) return { ok: false, reason: "suppressed earlier in this reply" };
    if (this.used) return { ok: true };
    let v: MoodVerdict = { ok: true };
    if (this.replies === 0) v = { ok: false, reason: "first reply of the conversation" };
    else if (voiceComment.test(this.userText)) v = { ok: false, reason: "reply to a comment about the voice itself" };
    else if (tag === "whisper" && !askedWhisper.test(this.userText)) v = { ok: false, reason: "whisper nobody asked for" };
    else if (this.replies - this.lastMoodReply <= MOOD_COOLDOWN_REPLIES) v = { ok: false, reason: `cooldown (a mood was used ${this.replies - this.lastMoodReply} replies ago)` };
    if (v.ok) this.used = true; else this.suppressed = true;
    return v;
  }
  /** The reply finished (one finished reply counts once). */
  finishReply() { if (this.used) this.lastMoodReply = this.replies; this.replies++; this.used = false; this.suppressed = false; }
}
