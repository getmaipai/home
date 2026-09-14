// RECALL-02: the shapes of a question about earlier talk, kept apart
// from episodes.ts (which opens the database on import) so guards.ts and
// the bench's scorer can read them without a store behind them.

/** RECALL-02: the shapes that ask what the hub itself said: the "you"
 * form of the recall package's own routing examples ("what did you
 * say / suggest / recommend / tell me"). Only then may an assistant-
 * side episode enter the prompt. */
const ASKS_WHAT_HUB_SAID_RE = /\b(?:what|which)\s+(?:did|had|have)\s+you\s+(?:say|said|suggest(?:ed)?|recommend(?:ed)?|tell|told|mention(?:ed)?|advise[d]?|propose[d]?|think|reply|answer(?:ed)?)\b|\bwhat\s+was\s+your\s+(?:suggestion|recommendation|advice|answer|take|idea)\b|\b(?:remind me|tell me)\s+what\s+you\s+(?:said|suggested|recommended|told)\b|\bdid\s+you\s+(?:say|suggest|recommend|mention)\b|\byou\s+(?:said|suggested|recommended|mentioned)\s+(?:something|that)\b/i;
export function asksWhatHubSaid(utterance: string): boolean {
  return ASKS_WHAT_HUB_SAID_RE.test(utterance);
}

/** RECALL-02: a turn that asks about earlier talk on either side, the
 * recall package's own routing examples ("what did I say / tell you",
 * "do you remember what I said", "what did we decide") and the hub's
 * shapes above: its answer is a restatement by design, so a restated
 * episode is the answer there, not an unrelated recall. */
const ASKS_ABOUT_EARLIER_TALK_RE = /\b(?:what|which)\s+(?:did|have|had)\s+(?:i|we)\s+(?:say|said|tell|told|mention(?:ed)?|decide[d]?|talk(?:ed)?|agree[d]?|ask(?:ed)?)\b|\bdo\s+you\s+remember\s+(?:what|when|if|that)?\s*(?:i|we)\b|\b(?:remind me|tell me)\s+what\s+(?:i|we)\s+(?:said|told|decided|mentioned)\b|\bwhat\s+(?:did|have)\s+(?:i|we)\s+(?:talk|talked)\s+about\b/i;
export function asksAboutEarlierTalk(utterance: string): boolean {
  return asksWhatHubSaid(utterance) || ASKS_ABOUT_EARLIER_TALK_RE.test(utterance);
}
