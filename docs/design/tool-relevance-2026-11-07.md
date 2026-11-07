# Offer the picture, video and music tools only when the thread points at making something (2026-11-07)

Status: proposal, no code. Item: AUDIT-TOOLS-01 (third part). Verdict: left to the architect. Source: the 2026-11-06 efficiency audit, item 4.

## 1. The cost today

An adult written chat with the picture, video and music engines ready offers every media tool on every turn, "hi" included. Measured over `backend/packages/*/manifest.json` before AUDIT-TOOLS-01, the conditional media tools came to about 34,000 characters of schema (the audit's 40,707 used a looser count; `edit_video` 12,976, `generate_video` 5,545, `generate_image` 4,880, `edit_music` 3,321, `generate_music` 3,245, `show_images` 2,617, `make_film` 1,423). AUDIT-TOOLS-01 part 1 cut the same seven to about 14,100 characters, and part 2 records the real figure per turn in `stats.tools_offered` (visible in the admin Performance page), so this note can be judged on measured numbers: read the median and the largest `tools_offered.chars` over a week before deciding whether the remaining cost is worth a gate.

The tools sit in the stable prompt prefix, so within one conversation the cache absorbs most of the cost. What stays is the first turn of every conversation, every cache break (a setting change, a model switch, the voice tools giving way on a small window) and the share of a small context window that no history can use.

## 2. What the code already does

`toolGates.ts` decides the offer set before the model sees the turn. Three kinds of signal exist today, and none of them reads the person's wording:

1. **Eligibility** (age, surface, role, household switches): a child gets no `generate_video`. This is rule 0 and does not change.
2. **Engine readiness**, latched per conversation (`latch.pictureEngineReady`, `videoEngineReady`, `musicEngineReady`): once the engine answered ready in a conversation, the tool stays offered for the rest of it, so a flapping engine does not make the tool vanish between turns.
3. **What the thread holds**: `videoEditAvailable` (a finished video is in this chat) latched as `latch.videoEditOk`; `itemRefOk` (the message carries an item reference) latched as `latch.itemRefOk`; `musicObject` (a song, band or album reference in the message, in the thread, or latched) latched as `latch.musicObject`; `editPictureOk` (a picture is in the conversation and an edit op is enabled).

The model-facing contract is `tool_choice: "auto"`: with the tools present, the model decides whether the person asked for something.

## 3. The proposal

Treat creation like editing already is: offer `generate_image`, `generate_video`, `generate_music`, `make_film` and `show_images` only on a turn where a structural signal says the person may be making something, and latch the offer for the rest of the conversation once it fires (the `itemRefOk` and `musicObject` latch shape, per conversation and per person, cleared with the conversation).

The signals, all structural:

- the composer's own create control or a Create page hand-off (the person chose to make something);
- an attachment on the message (a photo to animate, a song to change);
- a picture, video or song already in the thread (the `videoEditAvailable`, `editPictureOk`, `musicObject` family, extended to "any media made or attached here");
- an item reference in the message (`itemRefOk`);
- the previous turn offered the tool and the model called it, or the model's own last reply asked a question about making something (latched by the call, not by parsing the reply).

When none of these holds, the first-turn offer is the base set only. The cost moves to the one miss case below, and the model keeps its `tool_choice: "auto"` behavior on every turn where the tools are present.

## 4. What RULES.md says

Rule 1 ("The model decides, not a word rule") is the rule that bites:

- "No regex, word list or classifier reads open-ended wording to decide whether a message needs a search or a tool." A latch keyed on the words "draw", "picture", "song" or "video" in the message is exactly that and is rejected before it is written. The proposal therefore uses only the structural signals above and never inspects what the person typed. A learned or embedding score about "wants to make something" is also a classifier on open-ended wording; rule 1 allows one only in shadow (logged as a number, changing no turn), so it can inform a later rule change and cannot gate the offer here.
- "The offered tool set is a measured budget: the base set is the ten on the record; a conditional set (pictures, a link reader, media tools on a file turn) is offered only on the turn that earns it, each with its own bench row, never more than 16 on a turn." The conditional set is already defined as offered only on the turn that earns it, so a structural gate is consistent with the rule's text. Each tool keeps its `bench_row`, and the rule asks for a bench row per conditional tool: this change needs a CHAT-AB-01 fresh-set measurement (evidence recall and false searches, at least 3 repeats, per rule 3) showing no loss when the media tools are absent on a turn that the signals say is not about making.
- Rule 0 outranks everything: the gate may only remove a tool from a turn that was eligible for it; it never offers a tool the age or surface gates withhold.
- Rule 6 ("A failed tool never fails the answer") applies unchanged: a turn that lacks the tool answers in words and says so honestly if the person asked for something it cannot make there.

Whether a structural "might be making something" signal counts as "the turn that earns it" or as a word rule by another name is the architect's call; this note takes the first reading and states the second as the reason it might be rejected.

## 5. Risks

1. **The latch misses a request.** The central risk: the first message of a new conversation is "a sunset over the sea, painted" with no control used and nothing attached. The tools are absent, the model answers in words, and the person has to ask again or use the Create page. This is the failure the model-decides rule exists to prevent, and it lands on the most natural first message. Mitigation: keep one generic entry point always on (a single small `create_media` tool that, when called, makes the media tools available for the next round), so a request is never refused for lack of a tool, only delayed by one round. That is a second tool and a second definition of "make a picture", which principle 1 (one definition) disfavors.
2. **A second round costs latency.** Any "offer on the next round" design adds a model call to the first creation request in a conversation.
3. **The cache gets worse, not better, on the turn the offer changes.** Adding tools mid-conversation changes the prefix and breaks the cache once, at the moment the person starts making things. Offering a tool set that is stable for the whole conversation (today) is cache-friendly; this change trades the first-turn cost for a cache break later. The measured `tools_offered.chars` plus `cache_reuse_percent` per turn, both now in `stats`, decide whether the trade pays.
4. **Latch bugs show as ghosts.** A latch that fires on an attachment and never clears offers tools for an entire long conversation; one keyed per person and conversation, like the others, avoids a cross-person leak (the 2026-10 `musicObject` latch needed exactly that fix).
5. **Spoken and robot surfaces** have their own caps and budgets (`rounds: 0` on the Pi); the gate must not change a spoken turn (rule 0).
6. **The shrunk schemas may already be enough.** After part 1 the full media set is about 14,100 characters (about 3,500 tokens). If the measured median is close to that and cache reuse is high, the gate buys little and carries risk 1. That is a legitimate reason for the architect to reject this proposal.

## 6. Not decided here

Nothing in this note changes `toolGates.ts`, the budget cap, `RULES.md` or any handler. If the architect approves, the build is one slice: extend the existing latch with a `mediaMakingOk` signal built from the structural inputs in section 3, a bench row per tool, and a measurement of `stats.tools_offered` and cache reuse before and after on the Studio.
