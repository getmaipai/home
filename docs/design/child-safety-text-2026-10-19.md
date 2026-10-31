# Child safety in chat text: depiction is refused, discussion is not (CSAM-TEXT-01)
> Status (2026-10-31): superseded in part by [RULES.md](RULES.md): adult-side limits (rule 10).

Date: 2026-10-19. Status: owner-approved (rule wording, section 9, approved 2026-10-19); S1 (spec 0.1.192) and S2 (hub) built, S3
docs landed with this record. Owner: Jesse. This is the long-term record of the incident, the evidence, the research, the options weighed, the decision and
the build plan. Built: the small same-sentence tweak in section 6, and S1 to S3 of section 12 (see section 15).

## 1. The owner's ruling

On 2026-10-19 Jesse ruled, in his words: the point of the child-safety floor is to prevent the generation of sexual content involving
minors, in images, video and the like. Asking about a movie, a news article, true crime, fiction, health or personal advice must not
trigger it. Adults are uncensored for discussion. Implement it the way the leading companies do, exactly, and add nothing more.

## 2. What happened

An adult asked "what's the movie taxi driver about". The local model wrote a normal plot summary that named a 12-year-old character.
The reply was cut partway and the thread kept only a refusal line. The server log said the model's own reply was flagged by the safety
classifier mid-stream, category `csam`, signal `csam.minor_indicator_with_sexual_term`.

## 3. How the floor works today

One lexical rule, `detectCsam` in commons `spec/safety/ts/signals.ts`, refuses any text that holds a **minor indicator** (a numeric
age such as "12-year-old", or words such as child, kids, baby, minor, schoolgirl) and a **sexual term** (sex, sexual, nude, naked,
porn, explicit, erotic, lingerie, seductive, bikini ...) anywhere in it, plus a list of standalone terms. It runs in four places:

- the adult's message before the model sees it (`lib/turnMachine/nodes/safety.ts`, `lib/safety.ts`);
- the model's streamed reply, per sentence and on the whole reply so far (`nodes/outputGate.ts` StreamGate, `evaluateSafety` then
  `forOutput`), under RULES.md rule 10 (an adult's text streams as generated and the gate checks it as it arrives; released text is
  never retracted);
- the picture and video prompt floors (`lib/pictures/minorLine.ts`), which share commons' `fold.ts` normaliser;
- the finished-picture and finished-clip check by the local vision model (`lib/pictures/ageCheck.ts`, `laneGate.ts`), a separate,
  pixel-level check.

The Taxi Driver reply tripped it because the whole reply held "12-year-old" in one paragraph and "seductive" ("the seductive fantasy
of violent redemption") in another.

## 4. Evidence

86 labelled texts were written for this measurement (41 with intent to sexualise a minor, written non-graphically; 45 harmless:
film and book plots, news and legal reports, child-protection advice, parenting, medical and sex-education questions, ordinary
life). Data and scripts: `data-scratch/csam-proximity-2026-10-19/` (private).

| Rule | Harmful caught (of 41) | Harmless refused (of 45) | Repo csam corpus disagreements |
|---|---|---|---|
| Today, whole text | 36 (88%) | 24 (53%) | 0 |
| Same sentence only | 21 (51%) | 19 (42%) | 0 |
| Two adjacent sentences | 29 (71%) | 22 (49%) | 0 |
| 25-word window | 29 (71%) | 22 (49%) | 0 |
| 60-word window | 30 (73%) | 24 (53%) | 0 |
| Eight ambiguous words only count in the same sentence (landed, section 6) | 35 (85%) | 23 (51%) | 0 |

Harmless texts refused today, by kind: film and book plots 7 of 13, news, legal and protection 8 of 12, ordinary life, medical,
parenting and education 9 of 20. Most are refused because the age word and the sexual word sit in one sentence ("child sexual abuse
material is rising online", "sex education for middle school students", "our baby's sex will be revealed"). No proximity rule fixes
that, and the proximity rules lose 15 to 37 points of recall. A word list cannot separate discussion from depiction.

Known gaps in the shipped rule, found while measuring and unchanged here: "a teenage boy of 15", "She is 11." and "steamy" are not
recognised.

## 5. What the leading companies do (researched 2026-10-19)

- **The defined harm is sexual content involving minors, not the mention of minors.** OpenAI's Model Spec prohibits "sexual content
  involving minors", fiction included, requires a refusal, and allows discussion "in non-graphic educational or sex-ed contexts"
  (<https://model-spec.openai.com/2025-04-11.html>). Meta's Llama Guard category S4 covers responses that "contain, describe, enable,
  encourage, or endorse the sexual abuse of children" (<https://huggingface.co/project-free-llama/Llama-Guard-4-12B>). Anthropic's
  child-safety guidance bars sexualising minors in any context, fiction and role-play included
  (<https://support.claude.com/en/articles/15591275-child-safety-guidance-for-developers>).
- **Text is handled by the model's own safety training, plus optional policy-classifier models.** Llama Guard classifies whole
  prompts or responses against a category definition; it is far more accurate on responses (F1 0.938 overall) than on prompts (0.733),
  and child exploitation is its hardest category (F1 0.698 on responses)
  (<https://replicate.com/meta/llama-guard-3-11b-vision/readme>). OpenAI's moderation API gives a model score per category, including
  `sexual/minors` (precision 0.872 on text) (<https://developers.openai.com/api/reference/resources/moderations>). No researched
  provider uses a word-pair rule on adult text.
- **Generation is where the strict, non-configurable checks sit.** Gemini's CSAM filter is a separate always-on lane
  (<https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/configure-safety-filters>). Image pipelines check the prompt
  and then classify the finished image before returning it (<https://octo.ai/docs/faqs/trust-safety-api-responses>). Thorn's Safety by
  Design, signed by Amazon, Anthropic, Google, Meta, Microsoft, OpenAI and Stability AI among others, covers the whole life cycle,
  including training data (<https://www.thorn.org/blog/generative-ai-principles/>). Keyword filters alone are easy to dodge
  (<https://dbzer0.com/blog/ai-powered-anti-csam-filter-for-stable-diffusion/>).

Limits: nothing found on Midjourney or on age estimation; Anthropic's exact policy text on education and news was not retrieved
(third-party summaries only); several sources are vendor or community pages.

## 6. Interim step already taken

CSAM-SAME-SENTENCE-01 (commons `spec-v0.1.191` work, landed on commons main as `7a689cd`, untagged and not pinned by Home, owner
approved 2026-10-19): eight ambiguous words (seductive, suggestive, provocative, in heat, in bed, bikini, thong, cleavage) pair with a
minor indicator only in the same sentence. It fixes the Taxi Driver reply and nothing else of note (table, last row). It is the right
rule for teens, children and generation, where the pairing rule stays; this design removes the rule for adult text altogether.

## 7. Options weighed

| Option | Verdict | Why |
|---|---|---|
| Keep today's rule | no | refuses 53% of harmless adult texts |
| Proximity rules for all terms | no | recall falls to 51 to 73% for 2 to 5 fewer harmless refusals |
| Bigger or smarter word lists | no | cannot tell "abuse material is rising" from a request for it; each added word adds harmless refusals |
| Fable's design (2026-10-19): split explicit and co-occurrence hits, a local judge (Qwen3-4B, schema output, fails closed) on adult co-occurrence hits, hold-and-judge while streaming, a youth-cue judge on generation prompts, generation tools withdrawn for the rest of the chat after a refusal, spoken budget 0.6 s | not now | sound, but it keeps the word rule as the trigger and adds a judge, a hold, a taint and a second judge: more than the leading companies do. Kept here as the fallback if the model's own refusals prove too weak |
| A policy-classifier backstop on replies, Llama Guard style | later, owner's call | the one industry component this design does not add; its false negatives and the cost of a second model on every adult reply are unmeasured |
| Adult chat text with no check at all | no | the standalone terms and the request check are the industry's own blocklist and request refusal; removing them leaves nothing at the hub for an explicit request |

## 8. The decision (exactly this, nothing more)

1. **An adult's chat text no longer refuses on a minor word beside a sexual word.** The pairing rule is removed from the adult's reply
   gate (written and spoken) and from the adult's message check. A reply streams as the rest of an adult's chat does; a pasted news
   article or a question about a film passes.
2. **Kept for adults, as every provider's request refusal is:** the standalone explicit terms ("loli", "child porn" and the like), and a
   request to produce the content: one sentence of the adult's own message that asks the assistant to write, describe, draw, show,
   imagine or role-play AND holds a minor word AND a sexual word ("describe a 12 year old naked"). The owner may strike the request
   check; it is the only line of this design that is not simply a removal.
3. **Unchanged for everyone:** generation prompts and the finished-item check on pictures and video, a teen's and a child's chat
   (pairing rule included), the robot's own floor, notifications to parents, the refusal lines, CHAT-SAFETY-COPY-01's stop copy.
4. **Text that sexualises a minor is stopped by the model's own refusal training**, as in the leading assistants. No classifier, hold,
   taint or youth-cue judge is added.

## 9. Rule text for the owner's approval (exact words; commit with `Owner-approved: 2026-10-19`)

**RULES.md rule 10, added sentence:** "For an adult's chat, a minor word beside a sexual word is not a refusal by itself: discussion,
news, fiction, health and advice are not filtered. An adult's explicit term and an adult's request to write, describe, draw, show,
imagine or role-play sexual content with a minor still refuse; every generation prompt and finished picture or clip keeps the absolute
check, and a child's and a teen's floors are unchanged."

**SAFETY.md bullet 1, reworded:** "Child-safety protections on generation and chat are non-removable for children and teens, and on
every generation. For an adult's chat text they are the explicit-term and request-to-generate checks, which no setting disables; an
adult's discussion of the subject is not filtered. Code review treats any change that makes a protection bypassable, or that
reinstates a word-pair filter on adult discussion, as a correctness bug of the highest severity."

## 10. Supersedes

- MINOR-FLOORS-01 and the child-safety audit of 2026-10-17 (`data-scratch/csam-audit-2026-10-17.md`), only where they put the pairing on
  an adult's chat message and reply. Their pairing on generation prompts, a teen's and a child's chat and the finished-media check
  stands.
- CHAT-SAFETY-COPY-01 still applies to stops on an explicit term or a request to generate.
- CSAM-SAME-SENTENCE-01 (section 6) stays for teens, children and generation.

## 11. Reuse check

The request check reuses `foldForSafety`, `TermSet`, the age terms and the sexual terms of commons `spec/safety` (one definition,
principle 4) and the same-sentence split the 0.1.191 tweak has; only a short list of request verbs is new. Llama Guard and OpenAI's
moderation score were rejected for the request check: each is a model call on every message (latency on every adult turn, a second
model competing with the chat model) and OpenAI's is a cloud call, which Home never makes.

## 12. Build slices

- **S1 spec (commons):** `detectCsam` returns the standalone signal and the pairing signal as separate ids and exposes the request
  check; `checkSafety` keeps today's action for each. Corpus unchanged, plus request-check cases. One spec tag.
- **S2 hub (Home):** the adult band ignores the pairing signal, in the message check (`nodes/safety.ts`, `lib/safety.ts`) and in the
  reply gate (`outputGate.ts`, `evaluateReply`); teen, child and robot keep it; the adult message keeps the standalone and request
  checks. Tests: the Taxi Driver reply is released whole for an adult and cut for a teen and a child; an explicit standalone term and
  a same-sentence request still refuse an adult; a pasted news article passes; generation floors untouched.
- **S3 docs:** the two wordings in section 9, a user-doc line, the backlog item, this record's status.

## 13. Acceptance

On the 86-text set an adult's chat refuses 0 of 45 harmless texts (today 24) and still refuses every explicit-term text and every
same-sentence request text; the generation floors' tests pass unchanged; a teen's and a child's results are identical to today on the
whole set. The model's own refusals for the 41 harmful texts are not measured by generating them: a later check, if the owner wants
one, reads only the first words of a reply.

## 14. Risks

- The local chat model's own refusals are unmeasured. If they prove weak, the owner can add the classifier backstop (section 7).
- The robot alone keeps today's over-refusal until it can share the change.
- The request check is lexical and can be evaded by phrasing it does not list; the generation checks, which are the harm, do not
  depend on it.

## 15. Status log

- 2026-10-19: incident; measurement; interim same-sentence tweak landed on commons main; research; owner's ruling; Fable design
  weighed; this record written; architect ruled NEEDS-RULE-CHANGE (only the owner's approval of the two wordings was missing); owner
  approved both wordings the same day.
- 2026-10-19: S1 built: commons `spec-v0.1.192` (`SafetyContext.csamMode`). S2 built: `evaluateSafety(text, band, direction)`; the chat
  turn's message check, StreamGate, ReasoningLane, `evaluateReply`, answer blocks, composer rows and the LLM route pass the direction.
  S3: RULES.md rule 10 sentence committed with `Owner-approved: 2026-10-19`; SAFETY.md bullet 1 reworded in `getmaipai/.github`.
  Refinements found while building, within the owner's ruling: an adult's explicit term refuses only in a sentence that asks for
  something (a pasted news article that names "child porn" passes), and the words news and advice use ("csam", "pedophile",
  "Lolita") are not explicit terms for an adult. Measured on the 86 texts: an adult's message refuses 0 of 45 harmless (24 before)
  and catches 21 of 41 harmful (36 before); the rest rely on the model's own refusal and the generation checks.
- 2026-10-19, amendment (owner's ruling in chat): the adult message checks are removed. Probing the built rule showed it refused
  "what does loli mean?" and "show me loli detection methods in code" (the request verb check cannot tell asking about a thing from
  asking for it), and the owner's example "was paul reubens convicted for child porn" is a factual question that must get a clear
  answer. Research found no leading provider that matches an adult's words: Meta's Llama Guard category S4 judges what a response
  contains, describes or endorses; Anthropic's stated defense is model refusal training plus reporting; OpenAI's Model Spec, as
  reported, prohibits sexual content involving minors and allows non-graphic educational discussion. Section 8 items 1 and 2 now
  read: an adult's chat text, typed or generated, has no `csam` word rule. Production is stopped by the model's own refusal and by the
  generation checks (prompt floor, finished-picture check). Children, teens and the robot keep the floor. Section 9's two wordings
  are amended to match (RULES.md rule 10, SAFETY.md bullet 1). `adult_message` and `detectCsamAdultMessage` in commons are now
  unused by the hub; removing them is a follow-up in `commons/spec`. CSAM-TEXT-02 (b) and (c) decide whether a reply classifier is
  needed.
