# The response contract by surface (2026-09-21)

The owner's ruling, after a side-by-side with ChatGPT and a look at
what an Echo Show class hub does: people judge an answer's length
against the channel they are in, and we made one channel's rule govern
all of them. The humanistic chat program tuned every reply to the
spoken register (short, a few sentences, "the way a person talking out
loud would"), which is right for a robot and wrong on a screen where
someone typed a question and is reading. ChatGPT gives long structured
answers when typed and two-sentence answers in Voice, and nobody calls
Voice incomplete. So the register follows the surface, not a setting.
The controls are exactly ChatGPT's and nothing more (the owner's
ruling, revised the same evening: "follow what ChatGPT does exactly"):
the composer carries a thinking-effort control and a model picker
whose label reads the current choice ("Instant"), both from the
shipped Elements (`composer-model-picker`, the effort control if the
catalog ships one, otherwise the picker's own options), fed by the
Stack's roles and models through the Engines API; there is no
answer-length preference anywhere, on the settings page or in the
composer, because ChatGPT has none. Beyond those two controls the
override is language, which people already use ("shorter", "tell me
more", "just the number", "read me the whole thing"), honored for that
turn and the next few.

## Why this is a contract and not a prompt tweak

Today the persona prompt carries `NATURALNESS_POLICY` ("not the way a
screen would print them") and the engagement fragment "keep replies
short, usually just a few sentences" (`backend/src/lib/persona.ts`),
and they apply to every surface; the only surface-specific projection
is `spokenText` for `surface === "robot"` in `turnEngine.ts` (the first
sentence, links stripped). The wire already carries `reply.text` and
`reply.speech` and the structured parts, and the turn request already
carries `surface` (`"chat" | "overlay" | "pod" | "robot" | "tv" |
"phone"`). So the shape exists; what is missing is that the composer
produces one answer sized for speech and every surface gets it. The
contract inverts that: the turn produces the full answer once, and each
surface renders or speaks its projection.

## The three contracts

**Screen, typed** (`surface: "chat"`, the chat page on a laptop or a
phone, and `"tv"`): the full answer. Structure where it helps
(headings, lists, a table), sources, the model's thinking folded, the
generative parts (a weather chart, a forecast table, a spec sheet),
artifacts, follow-ups. Length follows the information need, never a
cap: "hi" gets "hey", a question about mortgage options gets sections.
The written register: formatting is allowed, a time may be "3:45 PM",
numbers may be digits. This is the ChatGPT bar.

**Voice** (`surface: "robot"`, `"pod"`, `"phone"` in a live voice
session, and dictation into the chat when the reply is spoken): the
answer first, in one to three spoken sentences, then an offer when
there is more ("want the details?"). Never read a list of eight aloud:
the top two or three, then "the rest is on your screen". The full
answer is still produced and lands on the nearest screen (the chat
transcript, the hub card). Chain of thought is never spoken. The
spoken register stays exactly what the humanistic program built:
`NATURALNESS_POLICY`, the formality and engagement fragments,
backchannels, memory, asking back.

**Glance** (`surface: "overlay"` and the future hub, an Echo Show class
device): a card built for two seconds, the number or state, one line,
an icon, plus the spoken lead; a tap opens the full answer. The card is
the same generative part the screen renders, at a larger size; nothing
is drawn for it. Alexa's weakness is being short and shallow; ours is
short and right, with depth one tap away.

The one profile-level exception is the child: a child's voice answers
stay short even on a screen, which is a parental control the parent
already expects, not a mode.

## What changes, in order

1. **RESP-01, the written register (M).** `persona.ts` gains a written
   policy beside the spoken one: full answers, structure where it
   helps, digits and formatting allowed, no "keep replies short"; the
   engagement fragment's brevity line moves into the spoken policy.
   `composePersonaPrompt` takes the surface class (`written` for chat
   and tv, `spoken` for robot, pod, phone-voice, `glance` for overlay)
   and picks the policy. The typed chat page sends `surface: "chat"`
   as today; the dictation path marks the turn spoken. Acceptance: the
   seeded voice set does not regress (its rows are spoken turns and
   keep the spoken policy); a new written-set of twenty typed questions
   from the corpus gets replies judged for completeness against the
   ChatGPT bar by the same judge the benches use; the "shorter" and
   "tell me more" overrides work on both surfaces.
   Amended 2026-09-22 (ARCH-AMEND-01, after the independent review's
   finding 3): the typed-screen cap does not live in `persona.ts`. It is
   the act table in `register.ts`'s `planFor` (a question is capped at
   two sentences and 60 words) and both generation paths set
   `max_tokens` from that plan, so a policy paragraph alone cannot
   deliver the written register. RESP-01 now does both: `planFor`
   derives the budget from the surface class (written: the information
   need, no act cap; spoken: today's table; glance: the card) and the
   persona policy splits as described above. One plan, the spec's
   ReplyPlan, is the only place length is decided; the overrides
   ("shorter", "tell me more") hold for the turn and the next three
   rather than for the rest of the conversation. The BACKLOG row is
   the current text.

2. **RESP-02, the spoken projection (M).** `reply.speech` becomes the
   voice contract: one to three sentences that answer, plus the offer
   when the written answer is longer than what was spoken; produced by
   the composer from the full answer (a second short generation on the
   same context, or the model's own lead paragraph when it is already
   short), never by truncation to the first sentence. A list reads its
   top three. The full answer is written to the conversation as today
   and the robot's protocol carries both. Acceptance: a bench row per
   shape (a one-line fact, a list, a procedure, a comparison) with the
   spoken text judged for "answers first, offers the rest".
3. **RESP-03, the glance projection (S, after the hub exists).** The
   overlay surface renders the structured part as the card and speaks
   `reply.speech`; a tap opens the screen contract. Blocked on the hub
   device; the wire needs nothing new.

4. **RESP-04, the composer's two controls (S, with SHELL-02 slice
   5).** The `composer-model-picker` Element as shipped, its options the
   Stack's models for the chat role (or Home's configured engines
   until the Stack runs Home), the label reading the current one; the
   thinking-effort control from the catalog if it ships one, else the
   picker's options carry it (Instant, Thinking); the choice rides the
   turn request (`thinking`, `model`) and is remembered per person
   without a settings page (the last choice, stored with the
   conversation). Voice and glance surfaces have no controls, as
   ChatGPT Voice has none.

Nothing here adds a settings key; `ui.*` keys are untouched. The chat
page's Elements already render everything the screen contract names
(SHELL-02's slices); the voice surfaces already consume
`reply.speech`. The order after the shell program: RESP-01 first,
because it is what a typed user sees today.
