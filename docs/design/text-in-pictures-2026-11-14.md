# Words in pictures: the right model, no stray text, and a spelling check (TEXT-PIC)

Status: design note, 2026-11-14. Owner rule (Jesse, 2026-11-13, direct message): "we need some sort of global rule for creating posters, album covers, etc: if the cover has text then you must use a model that is good with text; my current album covers have all sorts of typos." Second part (Jesse, same day): "for imaging not good with text, we should have a prompt addendum that says do not show any text." The rule text is in `docs/design/RULES.md`, section "Words in pictures" (W1 to W6). This note is the design behind it and the build rows.

## What is wrong today

- The picture lane picks a model by quality tier (`lib/pictures/quality.ts`: Quick is Klein 4B or ERNIE-Image-Turbo by the household's `engines.image.tier.standard` choice, Detailed is Z-Image-Turbo). Nothing looks at whether the picture must show words. The 2026-10-25 bakeoff (`image-model-bakeoff-2026-10-25.md`) found ERNIE-Image-Turbo the best of ours at readable text; Klein, the usual Standard model, is not. A cover or poster made on Klein has misspelled words.
- A picture that should show no words can still grow gibberish letters on signs, shirts, packaging and posters, because nothing tells the model not to.
- Nothing checks the words that did come out.

## The rule, in one paragraph

A picture that must show words (a poster, flyer, card, sticker with words, merch graphic, ad, sign, album, song, film or video cover with a title, a template with a headline blank) is made with a text-capable model (ERNIE-Image-Turbo), whatever the household's Standard choice is. A picture that must show no words, made with any other model, always carries the addendum "No text, no letters, no words, no logos anywhere in the picture." The picture's words are the exact words the maker gave; they are read back from the finished picture and compared; a miss is re-made, and if it still misses the person is told in one plain line and offered another take. Who decides that a picture has words is the model, or the data of the feature that prints the title; never a word list or a pattern in code (chat rule 1).

## Who says "this picture has words"

1. Chat: the chat model passes `words`, a list of the exact strings the picture must show, in `generate_image` (and in `edit_picture` when the change adds or changes words). The tool description says: "words: the exact text to show on the picture, spelled exactly; leave out when the picture must show no text." Empty or absent means no words.
2. A template record that shows words declares it through a blank whose value is the words (the existing `{{headline|...}}` blanks): a template carries `words_blanks`, the names of the blanks that are words; the blanks' values become `words`. Spec first (`media_template`, one optional list, CREATOR-01 pattern); until the spec release the three templates that need it (Ad poster, Poster, Flyer, Greeting card, Merch, After-hours show poster, Product photo with a card) are listed by id in one table in `lib/media/templates.ts`, replaced by the field.
3. A feature that prints a title on its own art passes the title: album and song covers, film posters, video covers, a companion's name card. The feature's code states `words: [title]`; it is data the feature owns, not a reading of anyone's wording.
4. The Create page: when no template declared it and the person typed their own words, Home asks the chat model once, with a short structured question ("Does this picture request ask for any words, names or numbers to be shown on the picture? Answer with the exact words, or none."), at the same priority as the other small helper calls; the answer becomes `words`. If the chat model is unavailable the picture is made as no-words (with the addendum) and a plain line says "I could not check for words. If you wanted words on it, say which and I will make another."

## Model choice (W1) and the addendum (W2)

- `words` non-empty: the model is ERNIE-Image-Turbo, always (an explicit Detailed request for a text picture still uses ERNIE: Detailed is about detail, text correctness wins). If ERNIE is not installed or cannot run: nothing starts, and one plain line says "Words on a picture need the text picture model, which is not added yet. An admin can add it in Settings, AI and models." (never a silent fallback to a model that misspells; the Activity status and the usual not-ready line apply, S6). If the engine is busy the job queues as any picture does.
- `words` empty: the model follows the existing tiers, and for every model that is not text-capable (Klein, Z-Image, and any future model not marked text-capable in the model catalog's one flag `text: true|false`) the prompt sent to the Stack ends with the addendum and the Stack's negative prompt, where the model takes one, gains "text, letters, words, watermark, logo". ERNIE needs no addendum. A style or LoRA that is itself about lettering is `words`-aware: it leaves the addendum off only when `words` is non-empty.
- The addendum is added once, after styles and presets, never to an edit of a picture that already has text (an edit keeps the picture's text as it is).

## The words, exactly (W3)

The exact words go into the prompt in quotes with the instruction "spelled exactly as written", and the words are also stored on the creation record (`creation-record`, one new list field `words`, spec first) so Another take and Make clearer know them.

## The spelling check (W4)

After a picture with `words` finishes, the Stack reads the text on it (Apple Vision `VNRecognizeTextRequest` through a small image-tools op `read_text`, on the Mac Studio, no network, returns the lines it found with a confidence) and Home compares: each required string must appear, case and spacing aside, as a whole line or in a line (edit distance 0 after normalising). A miss re-makes the picture with a new seed, at most two more tries, kept in the same job (one Activity row, "Making it again to fix the spelling"); every try is kept as a take, the best (most words right) is the one shown. If it still misses, the picture is shown with one plain line: "Some of the words did not come out right: <the words>. Make another or say how to change them." Not read (the op is not installed or fails) never claims the words are right: it says nothing is checked and shows the picture.

## What the person sees (Create and chat)

Owner ask (Jesse, 2026-11-13): "our create should show no text for standard or something, basically explaining it." The page says it in plain words, never a model name:
- The Quality chip's list says it beside each level: Standard "Fast. Shows no words on the picture."; Boost and Max "More detail. Shows no words unless you ask for them." (the `hint` of each tier on the Create page, one line each; the same words in chat when the model offers a level).
- When a request has words (chosen by the rule's W3), one line sits beside the Make picture button: "This picture has words, so Home uses its text picture model and checks the spelling." While it runs, the Activity line says "Making it again to fix the spelling" if a retry happens.
- When a request has no words and Home added the no-text addendum, nothing is said (it is the normal case); the Quality list line above is the explanation.
- If the text model is missing: the plain line of W1 beside the button, with where to add it.
Build row: TEXT-PIC-07.

## Build rows (BACKLOG, "Words in pictures")

- TEXT-PIC-01: the rule, the model flag and the model choice (RULES.md section, `text: true` in the model catalog for ERNIE-Image-Turbo and Qwen-Image if benched, `lib/pictures/quality.ts` choosing ERNIE for `words`, the plain line when it is missing).
- TEXT-PIC-02: the no-text addendum and negative prompt for non-text models (`lib/pictures/tool.ts`, `promptPlan`, the Stack call), with a bench of the same ten no-words prompts on Klein with and without the addendum (count pictures with stray letters).
- TEXT-PIC-03: `words` on `generate_image`, `edit_picture` and the template record; templates that show words; album, song, film and video covers pass their title; the creation record's `words` field (spec first).
- TEXT-PIC-04: the Create page's one structured check for words when no template declared them.
- TEXT-PIC-05: the spelling check: the Stack `read_text` op (Apple Vision), the compare and the retry in the picture job, the plain line.
- TEXT-PIC-07: the plain explanations on Create (the Quality level lines and the words note beside the button).
- TEXT-PIC-06: re-make the covers already made with typos on request: the Library's "Fix the words" action on a cover, using the stored words.

## What this does not do

It does not decide what an adult may put on a picture (rule 10 and the content policy stand), and it does not make any model better at text: it chooses the model that is, and checks the result. Edits that must change words in a picture wait for a benched text edit model (Qwen-Image-Edit-2511, CREATOR-43).
