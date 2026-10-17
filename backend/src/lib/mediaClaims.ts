// Picture and video honesty at the turn: a reply may say a picture or video is being made, ready or on its way only
// when the tool ran and a job exists. The model sometimes writes that line without calling the tool (live QA,
// 2026-10-17: about 1 turn in 8, and once an invented clip in a fresh chat). The model node holds the first round's
// text on a turn that plainly asks for one, runs ONE guarded re-ask when the held text claims a result with no tool
// call, and never lets a claim stand without a job. Both checks here are deliberately loose word tests used only as
// that safety net on such a turn; the decision to call the tool stays the model's.

const MEDIA_NOUN = "(?:pictures?|images?|photos?|photographs?|illustrations?|drawings?|paintings?|artworks?|posters?|logos?|wallpapers?|banners?|videos?|clips?|animations?|gifs?|renders?)";
const MAKE_VERB = "(?:make|makes|create|generate|draw|paint|render|produce|animate|sketch|illustrate|design|film|show me|give me|get me)";
const DRAW_ONLY = /\b(?:draw|paint|sketch|animate|illustrate|doodle)\b/;
const ASK_VERB_NOUN = new RegExp(`\\b${MAKE_VERB}\\b[^.!?\\n]{0,60}\\b${MEDIA_NOUN}\\b`);

/** Whether the person's message plainly asks for a new picture, video or animation (a loose test: a wrong yes costs one held reply and no re-ask unless it also claims a result). */
export function asksForMedia(message: string): boolean {
  const text = message.toLowerCase();
  return DRAW_ONLY.test(text) || ASK_VERB_NOUN.test(text);
}

const CLAIMS = [
  // "Here's your picture", "here is the video"
  new RegExp(`\\b(?:here(?:'s| is| are)|there(?:'s| is))\\b[^.!?\\n]{0,30}\\b${MEDIA_NOUN}\\b`),
  // "I've made a picture", "I'm creating the video", "I'll generate it"
  new RegExp(`\\bi(?:'ve| have|'m| am|'ll| will)?\\s+(?:just\\s+|now\\s+)?(?:made|created|generated|rendered|drawn|painted|started|making|creating|generating|rendering|drawing|painting|animating|working on)\\b[^.!?\\n]{0,60}\\b(?:${MEDIA_NOUN}|it|that|one)\\b`),
  // "your picture is being made", "the video is ready", "the picture has been created"
  new RegExp(`\\b${MEDIA_NOUN}\\b[^.!?\\n]{0,40}\\b(?:is|are|was|were|has been|have been|should be|will be|being)\\b[^.!?\\n]{0,30}\\b(?:made|created|generated|rendered|drawn|ready|done|finished|on its way|on the way|coming|below|underway|in progress|started|appear|show up)`),
  // "on its way", "it will appear below", "right below when it is ready"
  /\b(?:on its way|on the way|coming right up|(?:will )?(?:appear|show up)s? (?:right )?below|right below when)\b/,
];

/** Whether a reply says a picture or video is made, being made, ready or on its way. */
export function claimsMedia(reply: string): boolean {
  const text = reply.toLowerCase().replace(/[‘’]/g, "'");
  return CLAIMS.some((re) => re.test(text));
}

/** The reply that stands in for a claim when no tool ran, even after the re-ask. Says what happened and what to do. */
export const MEDIA_NOT_STARTED_LINE = "I didn't start that picture or video, so nothing is being made. Send the request once more and I'll try again.";

/** The one re-ask: the held reply claimed a result and no tool ran. */
export const MEDIA_REASK_INSTRUCTION = "You wrote that a picture or video is made or on its way, but you did not call the Make a Picture or Make a Video tool, so nothing was made. If the person asked for one, call the tool now with their request. If you cannot make it, say so plainly in one sentence. Do not say anything is being made unless you call the tool in this reply.";
