# Kid mode: the look, feel and voice of every app on Child controls (2026-10-17)

Jesse, 2026-10-17: the look and feel and the verbiage of every app must change when a person is in kid mode, and that is
"designed somewhere". It is, in pieces: six places already say part of it (section 1), none says all of it, and nothing says
how an app other than chat and settings takes part. This note gathers those pieces into one design that covers every app the
hub ships, through one token layer and one copy layer, and says what each app hides, locks or asks a grown-up for. Design
note only; no code. [RULES.md](RULES.md) governs; the two places where this note cannot follow a rule are reported in section
12, not worked around.

Two notes written the same day lean on this one and are referenced here as links:
[media-apps-blend-2026-10-17.md](media-apps-blend-2026-10-17.md) (video, music, podcasts, audiobooks as one media app family)
and [news-app-2026-10-17.md](news-app-2026-10-17.md) (the News app). They own what a child may watch, hear or read; this note
owns how the screen looks and what it says once that is decided.

## 1. What exists today (the design Jesse remembers)

| Piece | Where | What it already decides | What it leaves open |
|---|---|---|---|
| "Kids, in one rule" | `.github/docs/UI.md`, Patterns | Child profiles switch to kid presets from the person's controls: 2 cm targets, no drag or long scroll for the youngest, icons with labels and audio cues, a parental gate before anything leaves the household or grants a permission, copy at reading age 9. "No per-package work." | No tokens exist behind it; "icons with labels" collides with S1 (section 12) |
| The child view of chat | `commons/ui/docs/spec.md`, "The senses dock and the model picker" | No model name for a kid or parent; no reasoning; a one-line strip under the header saying who is talking | The strip's second clause ("a parent can see this chat") predates the 2026-10-07 ruling (section 12) |
| Ease presets | `commons/spec/ease/presets.json`, `ui/scripts/gen-ease-tokens.ts`, `frontend/src/shell/useEase.ts` (EASE-OF-USE-01) | The whole mechanism this note reuses: a spec record of named presets, a generated token block in `tokens.css` keyed on `data-ease-*` attributes on `<html>`, set by the shell, lockable by an admin per person | The presets are comfort, not mode; a child can pick Standard and lose the 2 cm targets |
| Settings copy per mode | `commons/spec/schemas/settings-key.schema.json` (`copy.does_child`, `does_teen`, `consent_*`, `control`, `band_default`), rendered by `spec/interpreters/ts/describeSetting.ts`; RULES S5; COPY-RULE-01 | One declaration per setting with a child and a teen line, composed per reader | Only settings have it; app screens, errors, empty states and buttons have no equivalent |
| Tour and help copy | `tour.schema.json` `title_by_audience`, `body_by_audience`; [help-2026-10-14.md](../plans/help-2026-10-14.md), "Kid and teen wording" | Child wording required for steps about settings, privacy or people; kid help pages say "ask a grown-up"; a child's Help never names an admin page | Each is its own small mechanism |
| How the hub talks to a child | `docs/dev.md` section 13 (the register table, 2026-09-14); `spec/safety/topic-copy.json` (MINOR-TOPICS-01); SAFETY.md | The model's register per mode: two sentences and 40 words for a child, no sources or links, simple vocabulary, care first; the topic block per mode | Covers the model's words, not the app's |
| The Home page for a child | [home-alive-01-2026-10-02.md](../plans/home-alive-01-2026-10-02.md) section 3; [home-page-2026-10-17.md](home-page-2026-10-17.md) | Which blocks a child and a teen see | Blocks only, no look or wording |
| Modes, not ages | BACKLOG MODE-NAMING-01, MODE-BIRTHDATE-01, MODE-GUEST-01 (owner, 2026-10-07) | Child, teen and adult are admin-set controls; person-facing copy never says age; the admin's assignment is the only input | The design file those rows ask for (`MODE-MODEL-DESIGN.md`) was never written; this note does not replace it, it uses the owner's words as given |

Not found: a note titled kid mode, kids mode or child mode in `docs/`, `docs/design/`, `docs/plans/`, the org docs or the
kit. The legacy mirrors and the archived pre-migration repo are not on this machine (searched by name under the home
folder), so nothing was copied from them; nothing in the pieces above cites them for this either.

## 2. Words: modes, not ages

The owner's ruling of 2026-10-07 stands: an admin puts each account on **Child controls**, **Teen controls** or **Adult
controls**, and that has nothing to do with age. This note uses those three names for the person-facing world and "mode" for
the design concept. "Kid mode" is the product as it looks and speaks for a person on Child controls. "Teen mode" is a light
touch on the adult product (section 5.4). In code the value is still `child | teen | adult` from `backend/src/lib/ageBand.ts`
and the spec's `age_band` enum until MODE-NAMING-01 renames it to `controls`
([modes-and-child-protections-2026-10-17.md](modes-and-child-protections-2026-10-17.md), section 4: `Person.controls`,
`Roster.controls`); this note adds no second name for it. The `data-mode` attribute below is a working name: it takes the
noun Jesse picks in that note's decision 1 (`data-controls` if he picks "controls") in the same slice as KID-MODE-03.

Person-facing copy in any mode never says "age", "age band", "age-appropriate", "for your age" or "reading age"
(MODE-NAMING-01's banned list). It says what the thing does for this person (COPY-RULE-01).

## 3. How the mode is chosen

- **The server decides, once.** The signed-in person's resolved mode comes with the person record the shell already loads
  (`person.age_band` today, read in `ChatPage.tsx`; `Roster.controls` after MODE-NAMING-01). The shell sets one attribute, `data-mode="child" | "teen" | "adult"`, on
  `<html>`, beside the five `data-ease-*` attributes `useEase` sets, in the same hook family and the same effect. Nothing else
  in Home reads the mode to style a screen; the kit's token blocks and Element variants answer the attribute.
- **No person can change it.** It is not a setting; there is no key, no selector, no Me page control. An admin changes a
  person's controls on the People page, where it already lives.
- **Unknown means child.** Before the person record arrives, and on any surface where the speaker is not identified (the
  precedent is `turn-signal.schema.json`, `age_band_basis: unknown_speaker_default`), the shell renders Child controls. A
  screen never flashes the adult look at a child.
- **Surfaces outrank the person (rule 0).** A shared screen (the TV, a kitchen tablet marked shared, the robot's face, a
  pod) renders Child controls unless an adult is identified on it, and shows no adult's content on it either. A surface
  setting (`device.shared`, household scope, admin only; one new key) says which devices are shared.
- **The mode changes the look and the words, never a protection.** Every hide and lock in section 6 is a convenience on
  top of a server refusal that exists whether or not the UI hides anything (ENGINEERING.md, Kid-safe: "enforced in the turn
  engine and the robot's authorizer, never by UI"). A test per app proves the route refuses a child what the screen hides.
- **Incognito** is an adult's feature (RULES S1 puts it in the rail's More menu); it is absent on Child controls. On Teen
  controls it follows the existing temporary-chat rules for a teen; the look is the teen's look with the `html.incognito`
  class on top, as today.
- **Go and the robot** read the same person record and the same spec record (section 4.1); the mode is not a web-only idea.

## 4. The look: one token layer

### 4.1 The record

One new spec record, `commons/spec/modes/looks.json`, in the shape of `ease/presets.json`: named modes, the dimensions each
sets, and the numbers behind each value. The kit's generator (`ui/scripts/gen-ease-tokens.ts`, extended rather than copied)
appends a second generated block to `tokens.css` keyed on `html[data-mode="..."]`. The parity test that already fails when the
committed block and the generator differ covers it. Go reads the same JSON. No Home CSS, no className, no wrapper (rule 9).

| Dimension | Adult controls | Teen controls | Child controls | Reached by |
|---|---|---|---|---|
| Surface and text colors | the person's `ui.look` as today | as adult | a warmer surface (cream in light, deep blue-grey in dark), the same text tokens, contrast floor 7:1 (`contrast: more`) | `--background`, `--card`, `--foreground`, `--muted-foreground` under `html[data-mode="child"]` |
| Accent set | the person's `data-accent` | as adult | four kid looks a child picks from (`sunny`, `ocean`, `forest`, `berry`), each a hue pair with its measured contrast; the adult looks are not offered | `ui.look` options filtered by mode in the spec (`range.options_by_mode`), `--primary`, `--accent`, `--ring` |
| Type scale | `--font-size-body` 13.5 px, 16 px floor on phone | as adult | body 18 px, titles 32 px, line height 1.5, a floor the person's ease text size can raise and never lower | the five `--font-size-*` tokens; the ease block multiplies on top |
| Font | `--font-sans` (system) | as adult | a rounded, open sans from the theme font allowlist (UI.md, Themes). Candidate: Lexend (OFL, built for reading proficiency), shipped with the kit, never fetched; measured against the system font on the reading tests in section 10 before it is chosen | `--font-sans` |
| Radius | card 16, control 10 | as adult | card 24, control 16, pill unchanged | `--radius-card`, `--radius-control`, `--radius` |
| Targets and spacing | 48 px, standard spacing | as adult | 76 px (the ease `large` value, about 2 cm), roomy spacing | the mode sets the ease floor (section 4.2) |
| Icons | lucide, three size tokens, stroke 2 | as adult | the same icons, one size step up, stroke 2.5, always with a visible name except in the rail (section 12.1) | `--icon-size-*`, `--icon-stroke`; the kit's icon primitive reads them |
| Illustration | the kit's line-style empty-state art | as adult | the kit's rounded, filled style of the same scenes, from the same lucide-free SVG set the kit ships | the kit `EmptyState` picks its asset by `data-mode`; a kit variant, not a Home prop |
| Motion | the kit's named motion | as adult | `calm` (no decorative motion, no autoplay, no parallax) plus one playful tap feedback (a 150 ms scale on press) that `prefers-reduced-motion` turns off | the ease motion block; `--motion-press` |
| Density | three columns on desktop, fifteen keys a section | as adult | two columns at desktop, one on tablet; six items before "Show more"; no infinite scroll | `--grid-columns-max`, `--list-page-size`; kit layout primitives read them |
| Sounds | as NOTIFY-SOUND-01: the hub-sent cues `ask`, `done`, `failed`, off by default | as adult | the same cues, switch and default; a parent sets a child's switch; kid mode adds no cue of its own (section 4.3) | section 4.3 |

What a token cannot reach is an additive kit variant first (rule 9b, second step), never a Home override. The ones this design
needs are listed in section 11 as KID-MODE-02's kit half: the `EmptyState` art variant, the icon stroke token, the
`MediaShelf` and `CardGrid` page-size token, the kit's `Alert` warm variant for child errors, a `size="kid"` on the
`Chip` and `Button` already sized by `--target-min`, and a read-aloud action slot on the kit card and page-header parts the
speaker button sits in (section 4.3; rule 9c, a prop or slot in `commons` first).

### 4.2 Mode floors and the person's ease

The ease presets stay what they are: comfort the person or an admin chooses. The mode adds floors, resolved in one place
(`easeResolve.ts`, pure, tested): on Child controls the effective targets are at least `large`, text size at least `120`,
contrast at least `more`, motion `calm`; the person's own ease choice can only go further. A child who picks Standard keeps the
2 cm targets. Teen and Adult controls set no floor. The resolver's output stays the same five `data-ease-*` attributes, so the
generated ease block needs no change for this.

### 4.3 Sounds and read-aloud

Tokens cannot carry audio. The cues, their switch and their default are already decided by
[notifications-and-asks-2026-10-17.md](notifications-and-asks-2026-10-17.md) (NOTIFY-SOUND-01): three synthesized tones
(`ask`, `done`, `failed`) under 400 ms, no sound files, in one module, `cues.ts` in `commons` `core` (lifted from FACE-02M's
`faceCaptureSounds.ts`, which becomes a caller); one person key, `ui.companion.sounds` (default off for everyone; a parent
sets a child's, and the child's own write is refused); and the hub decides whether a cue is due (the switch, quiet hours,
once per event) and puts `cue` on the feed event, so the client plays what it is told. Kid mode uses exactly that: a child
hears the hub-sent cues when a parent has turned the child's sounds on, and kid screens play no cue of their own. Kid mode
adds no key, no hook, no asset, no cue name and no second player.

Tap, oops and read-aloud cues for kid screens are left out on purpose: a cue the client starts on its own would have to
decide quiet hours itself, which NOTIFY-SOUND-01 forbids, and that note defines no hub-resolved "cues allowed now" signal a
local cue could read. Section 12 raises it as a question for that note's owner; until it is answered there, kid screens are
silent apart from the hub's cues.

`ui.enrollment_sounds` (person scope, default on, in `spec/settings/keys.json` and `backend/src/settings/uiKeys.ts`) is the
one other sound switch in Home, and two switches for one kind of thing is a second definition (principle 4). If Jesse
accepts decision 4 in section 12, KID-MODE-05 folds it into `ui.companion.sounds`: the spec key is removed, a migration
writes each person's stored `ui.enrollment_sounds` value into `ui.companion.sounds` where that person has no stored value
there yet and then deletes the old rows, and `frontend/src/lib/vision/enrollmentSoundsSetting.ts` retires. The enrollment
cues themselves do not change: `faceCaptureSounds.ts` plays them through `cues.ts` during a capture the person started that
moment, the one cue in Home that answers the person's own live action rather than an event, exactly as the asks note keeps
them; only the switch they read changes. KID-MODE-02 rewrites the key's `copy.does` and `copy.does_child` in the spec to
name every cue it switches (S5: a description says what the setting does for the reader). A person who never touched
either switch then hears no enrollment cues until sounds are on (the new default).

Read-aloud is the existing ease `read_aloud` value, on by default under Child controls: a speaker button in every page header
and on every card reads that screen's catalog copy (section 5: the screen strings and the spec records' copy fields) through
the household TTS in the person's own preset voice (`tts.voice_id`; VOICE-BROWSER-01D already restricts a child to presets).
Catalog copy is written and reviewed for the mode, not a model's or a source's words, so it is the same text on the screen and
passes no gate. Text that comes from a source or a model (a headline, a story, a media title or description, a search
result, a chat message) is never read by the client from what it rendered. It is spoken only as speakable text the hub built
from sentences that already passed the child output gate (SAFETY.md, "the output gate's grain follows the person": for a
child each sentence is checked before it is released; the same `StreamGate` a spoken turn uses, rule 10), sent to the client
as its own field beside the card; a sentence the gate held is in neither the card nor the audio. A card with no such field
reads its catalog copy only. The News app is the first user (its section 11, Listen, and section 9.5 here); any later app
whose cards carry source text gets the same hub-built field in its own slice, or its speaker reads catalog copy only.

## 5. The voice: one copy catalog with mode variants

### 5.1 Where every string lives (one definition each)

A person-facing string lives in exactly one of three places, by what kind of string it is. No component carries a string of
its own and no component holds an `if (mode === "child")` around a string.

| Kind | Home of the string | Mode variants | Already exists |
|---|---|---|---|
| A declared record's copy: a setting, a setting's reason line, a tour step, a topic block, a notification type, an error code | the spec record (`settings-key.schema.json` `copy.*`, `spec/vocab/setting-reasons.json`, `tour.schema.json` `*_by_audience`, `topic-copy.json`, NOTIFICATIONS.md's declarations, `spec/errors/errors.json`), rendered through `describeSetting` for settings (RULES S5) | the record's own fields (`does_child`, `does_teen`, the `child` and `teen` lines of each reason in `setting-reasons.json`, `title_by_audience.child`, and for `errors.json` the new `ui_message_child`, `ui_message_teen` beside `ui_message`) | yes, except the two error fields |
| An app screen's copy: labels, buttons, headers, empty states, inline help, confirmations | the per-package message catalog ENGINEERING.md already requires, which in Home is Lingui (`frontend/src/i18n.ts`, `frontend/src/locales/<locale>/messages.po`); a catalog package ships the same files under its `copy/` folder | one catalog per mode and locale: `en-US` (adult, the default), `en-US-x-child`, `en-US-x-teen`, with Lingui's `fallbackLocales` falling child and teen back to adult. Same message id, one id per string | Lingui exists; the mode catalogs are new |
| A model's words | nowhere; the model writes them fresh in the register of the person's mode and surface (rule 6, the register table) | the topic block and the content ceiling, per mode | yes |

The shell's `I18nProvider` activates `<locale>-x-<mode>` from `data-mode` once; every `t` call in Home and in every package
resolves through it. A string shown on a Child controls screen that has no child variant falls back to the adult string and is
counted by the coverage lint (section 10), whose baseline only shrinks, like the kit baselines.

### 5.2 Writing rules per mode

| | Adult controls | Teen controls | Child controls |
|---|---|---|---|
| Reading level | grade 6 to 8 (STYLE.md, the dad test) | grade 6 to 8 | grade 3 to 4 (UI.md's reading age 9), measured in the lint |
| Sentence | one idea, under 20 words | as adult | under 12 words; one sentence a line; no commas chains |
| Words | plain | plain, never talking down | the 1,000 most common words where one fits; "pictures" not "images", "make" not "generate", "grown-up" not "admin" or "parent" (a grandparent or carer may be the admin), "ask a grown-up" where the fix is an adult's |
| Tone | calm, second person | calm, respectful, no lecture | warm, second person, no baby talk, no exclamation points, no cheerleading |
| Names | the person's first name only where today's copy uses it | as adult | the child's first name in greetings, never in error text |
| What an error says | what happened and what to do (STYLE.md, Error messages) | as adult | the same two parts in child words: what happened in what the child saw, then one step the child can take or "ask a grown-up to ..." when the step is an adult's. Never "error", "failed", "invalid", "denied", "forbidden", "unauthorized", "fatal", "crash", "delete" (use "remove"), "warning" |
| What is never said | internal nouns (STYLE.md) | as adult | that an admin page, a model, a setting or another person's activity exists; anything that frames the controls as a punishment |
| Admin detail | the raw cause as a second line for an admin only | never | never |

A child's error keeps the two-part rule. "The video can't play right now. Try again, or ask a grown-up." names the problem the
child saw and the step. "Oops" alone is not an error message and fails the lint.

### 5.3 The per-surface copy table

Two tables, one per home from section 5.1. The first holds screen strings only: the first rows of the child and teen Lingui
catalogs. The adult column is today's string where one exists. Each row is one message id; the table is the seed of the
`.po` files, not a second copy of them. Nothing in it is a setting's text, a reason line or an error code's message: those
are in the second table and are never seeded into a `.po` file.

| Surface and id | Adult controls | Teen controls | Child controls |
|---|---|---|---|
| shell.search.placeholder | Search everywhere | Search | Find something |
| shell.profile.logout | Log out | Log out | Log out (no child variant; a Switch profile row waits on S1, RAIL-SWITCH-PROFILE-01) |
| shell.more.incognito | Incognito | Incognito | (absent) |
| home.greeting | Good evening, Sage | Good evening, Sage | Hi Sage |
| home.ask.title | Ask | Ask | What do you want to know? |
| home.pickup.title | Pick up where you left off | Pick up where you left off | Keep going |
| home.family.title | Your family | Your family | Your family |
| chat.composer.placeholder | Message | Message | Type here, or tap the mic |
| chat.empty.line | What can I help with? | What can I help with? | Ask me anything. I'm here. |
| chat.strip.who | (absent) | (absent) | You're talking with Bramble |
| chat.withheld (THIN-0B) | (model's words) | (model's words) | That's a good one for a grown-up. Want to ask about something else? (the model says this fresh; the catalog holds only the button under it: "Ask a grown-up") |
| search.results.web | Web results | Web results | From the web (pictures and pages the home allows) |
| search.results.none | No results. Try different words. | No results. Try different words. | I didn't find that. Try other words. |
| media.shelf.continue | Continue watching | Continue watching | Keep watching |
| media.player.next_up | Up next | Up next | (absent; no autoplay) |
| media.item.not_allowed | Not available for this person | Not available for you | Not for you yet. Tap to ask a grown-up. |
| media.ask.sent | Request sent to {admin} | Request sent | Sent to {admin}. They'll say yes or no. |
| news.section.top | Top stories | Top stories | Today's news for you |
| news.story.source | {source}, {time} | {source}, {time} | From {source} |
| photos.empty | No photos yet. Add some from your phone. | No photos yet. Add some from your phone. | No pictures yet. Ask a grown-up to add some. |
| photos.action.share | Share | Share | (absent) |
| studio.make.title | Make an image | Make an image | Make a picture |
| studio.prompt.placeholder | Describe what you want | Describe what you want | What should I draw? |
| studio.style.label | Style | Style | Pick a style |
| studio.job.failed | The picture could not be made. Try again, or check Settings, then Engines. | The picture could not be made. Try again. | The picture didn't come out. Try again, or ask a grown-up. |
| approval.title (ApprovalCard) | Go ahead? | Go ahead? | Ask a grown-up? |
| approval.waiting | Waiting since {time} | Waiting since {time} | Waiting for {admin} |
| approval.denied | Not allowed | Not allowed | {admin} said not now. |

The rows that live in spec records. Each is a field on the record named, changed in `commons/spec` first (KID-MODE-02) and
rendered by the existing interpreter; Home holds no copy of them, and the coverage lint reads them from the record.

| Record and field | Adult controls | Teen controls | Child controls |
|---|---|---|---|
| `spec/vocab/setting-reasons.json`, `household_admin.child.line` (the locked reason line, through `describeSetting`) | Set for the whole home by {admin}. | Set for the whole home by {admin}. | {admin} set this for the whole home. |
| `spec/vocab/setting-reasons.json`, new reason `guardian_picks` (`child.line`, `admin.line`) for a setting whose value a grown-up picks for a child, first used by `tts.voice_id` (VOICE-BROWSER-01D) | (admin line) You pick this for {person}. | (absent) | A grown-up picks your voice. Ask {admin} to change it. |
| `spec/settings/keys.json`, `tts.voice_id` `copy.does_child` | (the key's `does`) | (the key's `does`) | The voice that reads to you. |
| `spec/errors/errors.json`, `model_unavailable` `ui_message`, new `ui_message_teen`, `ui_message_child` | No model is available for this right now. | No model is available right now. Ask your admin. | The helper is asleep right now. Ask a grown-up to wake it up. |
| `spec/errors/errors.json`, `network_unreachable` | Couldn't connect. Check your internet connection. | Couldn't connect. Check the connection. | The home isn't connected right now. Try again in a minute, or ask a grown-up. |
| `spec/errors/errors.json`, `internal_error` | Something went wrong. Try again, or check Repairs. | Something went wrong. Try again. | That didn't work. Try again, or ask a grown-up. |

The child voice line `Ask a parent to choose your voice.` hand-written today in
`frontend/src/apps/settings/VoiceBrowserSection.tsx` (line 64, `target.role === "child"`) breaks S5 ("a page never
hand-writes setting help, option descriptions or a reason line") and is retired by the `guardian_picks` row above, rendered
through `describeSetting` like every other reason line (KID-MODE-06j).

### 5.4 Teen controls, the light touch

A teen gets the adult look and the adult catalog, with a teen variant only where the adult string names an admin action the
teen cannot take (engine, settings the teen does not have), where a string touches the teen's privacy (SETTINGS-DECISION-
TEEN-LIMITS: teens stay private, nobody sets their limits), and where the TEEN-RESEARCH-01 proposals land (the bedtime
extension card is the one approval a teen asks for). The teen catalog starts with about twenty strings and the coverage lint
reports no fallback for a teen as a defect only on those surfaces.

## 6. What kid mode hides, locks and asks

Three verbs, one meaning each. **Hide**: the control does not render, and the route refuses. **Lock**: the control renders
with its reason line from `setting-reasons.json` through `describeSetting` (the second table in section 5.3), and nothing
happens on tap. **Ask**: the control renders as "Ask a grown-up" and starts the approval in section 7.

| App | Hidden | Locked | Asks a grown-up |
|---|---|---|---|
| Shell | Incognito in the More menu; in the profile menu, Home settings (already owner and admin only, `homeSettingsRow`), the System status row while something is paused or down (already, CHAT-CALM-ERRORS-01d), and every admin notification type (the child's own Notifications entry stays, section 9.1); turn stats; the status dot (already) | | |
| Home | Admin strip, Repairs, Updates (HOME-ALIVE-01 section 3) | | |
| Chat | Model picker, thinking, reasoning, barge-in, sources and outbound links, temporary chat, web search when the household has it off for Child controls | search control when web search is on for Child controls shows the kid search (section 9.3) | a withheld question offers "Ask a grown-up" (THIN-0B's relay) |
| Search | Web results outside the child source policy, adult looks of result cards | | |
| Video, music, podcasts, audiobooks | Items outside the allowed set never appear in shelves or search (the blend note decides the set); comments, external links, "open in", autoplay next | the player's quality and speed menus | an item found by name that is outside the set: "Not for you yet. Tap to ask a grown-up." |
| News | Sources outside the child source list (the news note); comments; live tickers; breaking banners | | a story the child taps from a search result outside the list |
| Photos | Share, export, anyone else's albums, face names of people outside the household | Remove on a shared album | adding a picture from a device the child does not own |
| Studio (image, video, voice, music generation) | Model and LoRA choice, negative prompts, reference images of people, voice cloning, any adult-only style; the child floor on generation stays absolute (SAFETY.md) | the output size | sharing a made picture into a shared album |
| Settings | Everything but the person's own ease, look, voice preset and companion; the sounds switch (a parent sets it, NOTIFY-SOUND-01); People, Home settings, Developer tools, every advanced and expert level | voice (preset only, VOICE-BROWSER-01D), companions set (COMP-04), a locked ease key (the existing `set_by_guardian` reason line) | |
| Family (People) | Anyone's activity, roles, controls, settings; the Limits tab | | |
| Memories | Household records marked sensitive or adult-to-tell (register table section 13) | | |
| Privacy | The what-leaves-the-house table stays, in child words; export and forget are the admin's for a child | | |
| Help | Admin results and pages (help note) | | "not covered" suggests asking a grown-up |
| Weather, Library, Reference | Nothing hidden; the reference shelf is already filtered by controls (reference-reader note) | | |

Every hidden control has a backend test that the route returns a refusal for a person on Child controls, independent of the
UI (section 10).

## 7. Parent controls and approvals

Existing pieces, reused as they are: the kit `ApprovalCard` (APPROVE-CARD-02: Allow once, Deny, "Waiting since"); the
spec's policy cells with approvers `none < self < parent < never` (`spec/records/ts/validate.ts`); the per-person override
layer an admin writes (`lib/settingsLayers.ts`, `layeredScalar.ts`); locked notification types (NOTIFICATIONS.md); PARENT-
APPROVAL-01 for child routing and server refusal.

**The store is the one ask store, not a new record.** Home keeps every ask in one place. Today that is the `approvals`
table (`backend/src/db/schema.ts`, line 1563: `id`, `kind`, `person_id`, `details` JSON, `status` pending, approved or
denied, `decided_by_person_id`, `decided_at`, `created_at`), written and decided through `backend/src/lib/approvals.ts`
(`requestApproval`, the closed `KNOWN_KINDS` list, `summarizeApproval`) and announced by the existing `approvals.requested`
notification type (audience `adults`, `backend/src/lib/notificationTypes.ts`). The landed
[notifications-and-asks-2026-10-17.md](notifications-and-asks-2026-10-17.md) promotes that table, spec first, to the one
`Ask` record (`commons/spec/schemas/ask.schema.json`; the table migrates into `asks` with `kind: approval` and
`decided_by: parent`, ids kept; BRAKES-02b) with one answer path, `POST /api/asks/:id/answer`, and one list,
`GET /api/asks?open=1`, which returns the viewer's own asks. Kid mode uses that record and adds nothing beside it: no table,
no column, no migration, no spec record and no route of its own. The kid-mode slices that carry an Ask wait for BRAKES-02b,
so there is never a kid path on the old table to port.

What kid mode adds to the `Ask` record is data only: four approval summaries in its fixed template list (the list
`summarizeApproval()` holds today, keyed there by `install_package` and `browse_url`): `watch_item` and `listen_item` for an
item outside the child's set, `open_story` for a story outside the child's list, `share_to_album` for a made picture or a
picture from another device. Each summary names only the subject (the title of the item, story or album). The record's
`kind` is `confirm`, `approval` or `question`, so which field carries the template key is the asks note's to name; that
note leaves it open, section 12 raises it with its owner, and kid mode invents no field. Allow on `open_story` opens
that one story through the news note's own release path (the shelf's `band_ok` and the child output gate), never around it.

The "Ask a grown-up" flow, one shape for every app:

1. The child taps Ask. The hub writes one `Ask` of `kind: approval`, `decided_by: parent`, for the child, with the subject's
   summary. It never carries the child's history or anything the child did before (NO-CROSS-USER-VISIBILITY-01: no user
   sees what another user does).
2. The adults get the existing `approvals.requested` notification ("Bramble is asking: watch {title}") on their own
   devices; the card is the kit `ApprovalCard` with Allow and Deny, as the asks note gives a parent for a child's ask,
   answered through its one answer path. There is no "Always allow" on a child's ask (the asks note: never offered to a
   child).
3. The child's screen shows "Waiting for {admin}" and the result when it comes, read from the child's own ask through
   `GET /api/asks?open=1`, as the asks note's child row says ("Asked a parent", then the answer). The child never sees the
   Allow or Deny controls and cannot answer or take back the ask; only the adults the answer path allows can answer it.
4. The allow is scoped to the one subject and the one time. A lasting yes is not an answer to an ask: it is the existing
   source of truth for that app, MEDIA-KID-01's allowlist for media and an admin ticking a feed list for the child type for
   News, set on the screens that already own them. So there is no second store of permissions and no second store of asks.

What a parent sees: the request, the subject, their own answer. Never the child's chats, searches, plays or pictures. What a
parent sets: the controls (People page), the per-person overrides (the existing settings layers), the ease locks, the child's sounds switch (NOTIFY-SOUND-01),
the child's voice preset, the companion set, the kid look if they want to fix it. All of it on screens that already exist;
this note adds no parent dashboard.

## 8. Accessibility

- **Reading level** is measured, not hoped for: the lint in section 10 scores every child string at grade 4 or under and
  every adult and teen string at grade 8 or under, with the banned-word lists from section 5.2 and MODE-NAMING-01.
- **Targets**: 76 px on Child controls everywhere, the rail included (S1 already follows the target token).
- **Read-aloud**: section 4.3; the speaker button has the first focus after the page title, so a child who cannot read yet
  reaches it by one tab or one tap.
- **Voice in**: the composer mic and the wake word are the child's first input; every kid screen with a text field accepts
  dictation through the existing STT path.
- **Contrast** 7:1 on Child controls; the kit's contrast tests already prove the `more` value.
- **Motion**: calm; `prefers-reduced-motion` also removes the press feedback; nothing autoplays, nothing scrolls on its own.
- **Simple screens** replace "the youngest": no sub-mode by age (section 2). The ease `simple_mode` value, which an admin can
  turn on and lock for a person, removes drag gestures (a reorder gets up and down buttons), long lists (pages of six with a
  "More" button) and nested menus. It is the same switch for a child and for a grandparent, which is the point of modes.
- **Focus**: the kit's visible focus ring at the larger stroke; TV focus rules unchanged.
- **Screen reader**: every icon has its name (the rail's accessible names already); the read-aloud text and the accessible
  name are the same string from the catalog, one definition.

## 9. Per app: the concrete screens

### 9.1 Shell and Home

The rail keeps its shape (S1): 76 px wide on Child controls by the target token, icons only, accessible names and tooltips.
Section 12.1 reports the label question. The profile menu keeps S1's entries in S1's order, minus only what section 6
hides: Notifications (the child's own types only; an `adults` or admin audience type never reaches a child), System status
(the "Good" row; absent while something is paused or down, as today), Settings (the child's own area, section 9.8), Help,
and Log out, unchanged (a Switch profile row is RAIL-SWITCH-PROFILE-01's and waits on S1, per
[people-roles-and-account-2026-10-17.md](people-roles-and-account-2026-10-17.md)). Home settings is absent because S1 already makes it owner and
admin only; Incognito, in the More menu, is absent on Child controls (section 3). The phone
drawer lists the apps the child may open; an app the child may not open is absent, never greyed. Home follows
HOME-ALIVE-01 section 3 and home-page-2026-10-17 for blocks; in kid mode the greeting is "Hi Bramble", Ask is the first
block at full width with the mic beside the field, the three starters are pictures with one line each, "Keep going" shows
three chats as large cards, "Your family" shows faces and first names. No counts anywhere.

### 9.2 Chat

ChatGPT's layout (S2) on the kid tokens: the message column at the child's type size, the composer compact variant with the
mic as the primary control, the companion's face at 64 px in the empty state. Hidden and locked per section 6. The strip under
the header says only who is talking (section 12.2). Reasoning never arrives (SAFETY.md), so there is nothing to hide
client-side. A tool refusal or a lookup that did not happen is the model's own sentence (rule 6) in the child register; the
catalog holds only the buttons around it. Pictures a child sends go through VISION-04 unchanged.

### 9.3 Search

The global Search field reads "Find something". Results are cards with a picture, a title and one line, from the child's
source policy only (rule 0's SafeSearch, sources and cleaning, and the locked adult-site list); a card opens inside Home,
never a raw outbound link. No "web results" column of blue links. The search answer, where the model writes one, is in the
child register with no citations by number (`point` forbidden); the sources are the cards themselves.

### 9.4 Video, music, podcasts, audiobooks

The blend note decides the library, the allowed set and the player. On Child controls: shelves of six large tiles with the
title under the art (YouTube Kids' density, not YouTube's), one row per shelf, "More" instead of infinite scroll; the player
shows play, pause, back 10, forward 10 and the volume, with the speed and quality menus locked; no "Up next" and no autoplay;
no comments, descriptions trimmed to two lines in child words where the source gives none; a progress ring on the tile
instead of a bar. An item outside the set that a child reaches by name shows "Not for you yet. Tap to ask a grown-up." Audio
apps (music, podcasts, audiobooks) share the same tile and player; the audiobook player adds a chapter list as large rows.

### 9.5 News

The news note decides the sources and the story record. Jesse decided on 2026-10-17 (decision 1 of
[news-app-2026-10-17.md](news-app-2026-10-17.md)) that a child may open the News app on kid-safe sources only: the child pages
(Today, Following, Channel, Story, Saved) carry `min_role: child` and My Mix `min_role: teen`. On Child controls the app shows "Today's news for you" as one column of story cards (picture, headline,
"From {source}") from the Kids' lists only, no live ticker, no breaking banner, no comments, no outbound link. Read-aloud
follows section 4.3: the page header's speaker reads the page's catalog copy; a card's speaker reads only the card's
speakable text, which the hub builds from the headline and source line after each passed the child output gate (news note,
section 11, "Listen"), never text the client assembles from the card's fields. A story is spoken by the news note's Listen,
gated sentence by sentence on the hub the same way; a sentence the gate holds is neither shown nor spoken. Teens get the
adult layout with the teen source list.

### 9.6 Photos

The child's own pictures and the shared family albums an admin shares with them. Big square tiles, pinch to zoom in the
viewer, Favorite as the one action; Share, Export and other people's albums hidden. "No pictures yet. Ask a grown-up to add
some." as the empty state with the rounded illustration.

### 9.7 Studio (image, video, voice and music generation)

Child profiles are restricted by default and the generation protections are absolute (SAFETY.md). The kid Studio is one
screen: "Make a picture", a field "What should I draw?" with the mic, a row of style chips with pictures (Cartoon, Crayon,
Photo, Clay), a Make button, and the result with Save and "Put it in the family album" (an Ask). Hidden: model, LoRA,
negative prompt, seed, reference images of people, voice cloning, adult styles. Video and music generation follow the same
one-screen shape when they ship (MEDIA-HOST-02, 03). A failed job says "The picture didn't come out. Try again, or ask a
grown-up." and never shows a model name or an error code.

### 9.8 Settings

The one kit `SettingsShell` (S4) draws the child's own area: Look (the four kid looks as big swatches), Text and buttons (the
ease card as today), Read aloud, My voice (the preset list, with the `guardian_picks` reason line from section 5.3),
My companion. Every line, reason lines included, comes through `describeSetting` from the spec record (`does_child` and
`setting-reasons.json`), never from the page (S5). Nothing else exists
on the page; no advanced fold, no search box for settings a child cannot reach.

### 9.9 Family, Memories, Privacy, Help, Weather, Library and Reference

Family: faces and first names, nothing else (HOME-ALIVE-01). Memories: the child's own, as cards with "Keep" and "Forget";
the judge already keeps sensitive household records out. Privacy: the same page with the child catalog's words ("Nothing you
do here leaves your home."). Help: the kid pages from the help note, read-aloud on. Weather: the card as shipped at the kid
type size. Library and Reference: the child's shelf, large covers, the reader at the child's type scale and line height.

## 10. Testing

- **Snapshot per mode.** `scripts/screenshot.ts` already captures the three modes for the approval card; it grows to every
  app route at 1440 and 390, light and dark, for each mode, opened and judged before a slice is done (STYLE.md, the pipeline).
  A kid capture that would not be recognized as the same page in the adult capture is a failure, like the phone rule in
  UI.md.
- **Copy coverage lint.** A test renders each app route under `data-mode="child"` against the seeded demo household and lists
  every string that came from a fallback to the adult catalog. The list is a shrink-only baseline
  (`frontend/src/dev/copy-mode-baseline.json`); a new fallback fails the gate.
- **Reading-level lint.** Every child string scores grade 4 or under, every adult and teen string grade 8 or under, by
  extending the existing `scripts/reading-level.ts` (already on `text-readability`, MIT, and run by `check.sh`; nothing
  hand-rolled, no second scorer),
  plus the banned-word lists. Runs on the `.po` files and on the spec records' copy fields in `check.sh --pre`, beside
  COPY-LINT-01.
- **Tokens and targets.** The kit's contrast and ease token tests gain the mode block: 7:1 on every text and surface pair
  under `child`, `--target-min` 76 px, body 18 px. The screenshot pipeline's clipping and undersized-target check runs on the
  kid captures.
- **Server refusal per hidden control.** For each row in section 6, a backend test calls the route as a person on Child
  controls and asserts the refusal, with the UI absent from the test. These are the tests that make the hides a convenience.
- **Mode never loosens.** A test that a person on Child controls with every ease key set to Standard still resolves `large`
  targets and `more` contrast; a test that no settings key can set `data-mode`.
- **Read-aloud** speaks only catalog copy or hub-gated speakable text: a test compares the TTS request text with the rendered
  catalog copy; a test that a card's speaker sends its hub-built speakable field and never a headline, title or message
  string taken from the rendered card; a test that a sentence the child output gate held is absent from the speakable
  field (the news note's gate test covers News).
- **Spec copy stays in the spec.** The coverage lint fails when a `.po` file holds a message id for a setting's text, a
  reason line or an error code (section 5.3's second table); a test that `VoiceBrowserSection.tsx` renders the child line
  from `describeSetting`.
- **Asks reuse the one record.** A test that each new summary kind writes an `Ask` with `decided_by: parent`, that a child
  lists only their own asks and that the answer path refuses any answer from the child.

## 11. Build order and backlog rows

Spec and kit first, shell second, copy third, then one slice per app, each small and verifiable. Rows are in
`docs/BACKLOG.md` under "Kid mode (owner, 2026-10-17)".

1. KID-MODE-01 (this note). Done when landed and ruled on.
2. KID-MODE-02 (commons, S to M): `spec/modes/looks.json`, the generated mode block, the kit variants in section 4.1, the
   the `ui.companion.sounds` copy rewrite (only if decision 4 is accepted), `errors.json` `ui_message_child` and `ui_message_teen` with the section 5.3 rows,
   the `setting-reasons.json` rows (the `household_admin` child line, the new `guardian_picks` reason), `tts.voice_id`
   `copy.does_child`, `range.options_by_mode` on `ui.look`. New tags; Home pins.
3. KID-MODE-03 (home, S): the shell sets `data-mode`, the mode floors in `easeResolve.ts`, unknown means child, the shared
   surface key, tests from section 10 for floors and for "no setting sets the mode".
4. KID-MODE-04 (home, M): the child and teen Lingui catalogs, the provider wiring, the coverage lint and its baseline, the
   reading-level lint, the screen rows of section 5.3 (the first table only; the spec rows come from KID-MODE-02).
5. KID-MODE-05 (home, S): the read-aloud button (catalog copy only, section 4.3) on the existing surfaces; after
   NOTIFY-SOUND-01 and only if Jesse accepts decision 4, `ui.enrollment_sounds` folded into `ui.companion.sounds` with its
   migration.
6. KID-MODE-06a to 06k (home, S each): one slice per app in section 9, each with its section 6 refusal tests and its
   captures; a slice with an Ask adds its summary kind to the one `Ask` record and waits for BRAKES-02b (section 7); 06j retires the hand-written
   voice line. Media and News slices wait for their own notes' first slices; News is unblocked by the news note's decision 1 (accepted 2026-10-17) and builds with NEWS-03.
7. KID-MODE-07 (home, S): the screenshot matrix per mode and the judged captures in the docs, plus a user page "What your
   kid sees" in `docs/user/` (grade 6).

Reuse check: Lingui (already in use) for the catalogs; `text-readability` for the lint; the kit's own `EmptyState`,
`ApprovalCard`, `SettingsShell`, `MediaShelf`, `CardGrid`, `Chip`, `Button` and `Alert` for every screen; the ease generator for
the token block; the settings layers for locks; NOTIFY-SOUND-01's hub-sent cues, `cues.ts` and `ui.companion.sounds` for every
sound (no hook, no files, no cue or switch of kid mode's own); `describeSetting`, `setting-reasons.json` and `errors.json` for every
setting, reason and error line (no `.po` copy of them); the one `Ask` record of the asks note (today's `approvals` table, migrated by
BRAKES-02b) and the `approvals.requested` notification for every Ask (no table, record, route or migration of kid mode's
own; a separate `ApprovalRequest` record was considered and dropped as a second store); the news note's hub-gated speakable text for source text read aloud. Nothing in
this design is a new component.

## 12. Decisions for Jesse

1. **Rail labels (S1).** UI.md's kid rule says "icons with labels"; RULES S1 says the rail "never expands, has no labels".
   This note follows S1 (icons only, 76 px, names by tooltip and read-aloud on focus). If Jesse wants labels under the
   icons in kid mode, that is a NEEDS-RULE-CHANGE on S1; nothing here changes it.
2. **The child strip's second clause.** The kit spec's child strip says "a parent can see this chat". The owner's ruling of
   2026-10-07 (NO-CROSS-USER-VISIBILITY-01) says no user sees what another user does, parents included. This note's strip
   says only who is talking. The kit spec sentence is stale against the ruling; the kit's own record changes with the
   commons change in KID-MODE-02 if Jesse confirms.
3. **The kid font.** Lexend is proposed and will be measured; "keep the system font" is the cheaper answer and loses only the
   reading gain the measurement will show or not show.
4. **Enrollment cues follow the one sounds switch** (KID-MODE-05 waits on this). Folding `ui.enrollment_sounds` (default on) into `ui.companion.sounds`
   (default off, NOTIFY-SOUND-01) means a person who never touched either hears no enrollment cues until they turn sounds
   on; anyone who set enrollment sounds keeps their choice. Recommended: accept it (one switch, one definition). The
   alternative is to keep `ui.enrollment_sounds` as a second switch. Whether a child's sounds start on is the asks note's
   decision 3, not this note's.
5. **Teen mode stays light** (section 5.4). Say if a teen should get a look of their own; this note argues against it,
   since the ruling is that a mature teen may be on Adult controls and a teen look would read as a label.
6. **For the asks note's owner (not a rule change):** two open points that kid mode needs and does not invent. (a) A
   hub-resolved "cues allowed now" signal on the feed, so a kid screen may play a tap or read-aloud cue without deciding quiet
   hours itself; without it kid screens stay silent apart from the hub's cues. (b) The `Ask` field that carries an approval's
   summary template key (`install_package`, `browse_url`, and kid mode's four).
7. **For the media note's owner:** the media apps blend note's reader read-aloud uses "the household's child-safe voice"; this note
   uses the person's own preset voice (`tts.voice_id`, presets only for a child). One of the two changes; recommended: the
   person's preset, since VOICE-BROWSER-01D already limits a child to presets.

## Supersedes

- **`ui.enrollment_sounds`** (spec `settings/keys.json`, `backend/src/settings/uiKeys.ts`,
  `frontend/src/lib/vision/enrollmentSoundsSetting.ts`): replaced by `ui.companion.sounds`, the one sounds switch of
  NOTIFY-SOUND-01 (section 4.3). KID-MODE-05 removes the spec key, migrates each person's stored value into the one switch
  where it has none and deletes the old rows, and moves the enrollment cues onto it.
- **The hand-written child voice line** "Ask a parent to choose your voice." in
  `frontend/src/apps/settings/VoiceBrowserSection.tsx` (line 64): retired for the `guardian_picks` reason row in
  `spec/vocab/setting-reasons.json`, rendered through `describeSetting` (section 5.3; S5). KID-MODE-06j.
- **`setting-reasons.json` `household_admin.child.line`**: today's "Set for the whole home by {admin}." is replaced by its
  child wording in KID-MODE-02.

It extends, and does not replace, UI.md's "Kids, in one rule", EASE-OF-USE-01, COPY-RULE-01, HOME-ALIVE-01 section 3, the
help note's "Kid and teen wording", the register table in `docs/dev.md` section 13, the approval queue of
the one `Ask` record and NOTIFY-SOUND-01 of [notifications-and-asks-2026-10-17.md](notifications-and-asks-2026-10-17.md),
the controls of [modes-and-child-protections-2026-10-17.md](modes-and-child-protections-2026-10-17.md),
[media-apps-blend-2026-10-17.md](media-apps-blend-2026-10-17.md) and
[news-app-2026-10-17.md](news-app-2026-10-17.md); it reports two conflicts (section 12) rather than resolving them.

## Architect verdict

Ruled by the `architect` agent on this note's text; the record is `data-scratch/architect/KID-MODE-01.verdict`.

- First pass, 2026-10-17: REJECTED on S5 (setting copy in a Lingui catalog), a second approvals store, read-aloud of
  ungated news text, and an inconsistent child profile menu, plus a Supersedes section that said "Nothing".
- Second pass, 2026-10-17: APPROVED. All four fixed and Supersedes present; non-blocking follow-ups folded in (a locked ease
  key is a Lock, not an Ask; the media slices cite MEDIA-KID-01).
- Third pass, 2026-10-17, after rebasing onto notes that landed meanwhile: REJECTED on four second definitions against the
  asks note (a child taking back a parent-ask, a second "Always allow", the child's own sounds switch, a client deciding a
  cue). Fixed: the child cannot answer or take back an ask, the parent gets Allow and Deny only with lasting yeses in each
  app's existing list, the sounds switch is the parent's, and kid mode plays only the hub's cues.
- Fourth pass, 2026-10-17: APPROVED. Non-blocking points folded in: the reading-level lint extends
  `scripts/reading-level.ts`, the speaker button's kit slot is listed for KID-MODE-02, an allowed `open_story` still goes
  through the news release path, the read-aloud voice question is decision 7. If Jesse accepts decision 4, the asks note's
  `ui.companion.sounds` meaning gains the enrollment cues and that is added to Supersedes then.
