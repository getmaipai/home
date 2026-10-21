# A robot's companion sets its controls (2026-10-21)

> **Superseded in part (2026-10-21, later):** decisions 2 and 3 (the companion's type, from `min_role`, sets the band) are replaced by
> [dynamic-companions-2026-10-21.md](dynamic-companions-2026-10-21.md): the band is the robot's controls level and a companion declares an
> audience floor. The rest stands.

Owner ruling, chat, 2026-10-21 (Jesse): a robot's companion decides how the robot answers and which controls (child, teen or adult)
apply to it. The fix for a flat, terse robot is not speaker identification. Rules in [RULES.md](RULES.md) govern; one edit to rule 0
is made here under `Owner-approved: 2026-10-21 (chat)`.

## The problem

Every StackChan turn is planned as a child: `plan.age_band: "child"`, no react, care or ask_back move, 30 to 40 words. The robot sends
no speaker identity (`speaker_evidence: null`), and `effectiveBand()` in `backend/src/lib/turnContext.ts` gives an unknown robot
speaker the child result (`age_band_basis: unknown_speaker_default`, [modes note](modes-and-child-protections-2026-10-17.md) lines 46,
133, 174). The reply is also composed with the signed-in owner's companion (`persona.active_id`, the plain "default" one: brief, no
follow-up), so even a band fix would not make it lively. And "Is it going to rain?" answers "I can't tell you ... without knowing
where you are" because the live household has no `household.home` and the turn takes the place from the unknown speaker's own
account.

## Decision

1. **A robot has two admin-set values**, both device-scope settings, written in Settings, Devices, the robot's page:
   - `robot.controls`: `child`, `teen` or `adult`. Default `child` (the strictest, so nothing weakens by default).
   - `robot.companion.id`: a companion package id, or empty for none.
2. **The companion's type is its manifest `min_role`** (no new field, so no spec change): `child` or `guest` reads as a child
   companion, `teen` as a teen companion, anything higher as an adult companion. A robot may use a companion whose type is at or
   below its controls: a child robot only child companions, a teen robot child or teen, an adult robot any.
3. **The band of a robot turn.** An unknown speaker (every robot turn today) gets the robot's companion type when a companion is
   assigned (and its type fits the robot's controls), else child, exactly as before. A speaker the robot names gets the stricter of
   their own band and the companion type (tightening only). **Speaker evidence alone decides memory access and acting on the signed-in
   account.** `speakerIsAnonymous()` is unchanged, so an unknown speaker still reaches none of the signed-in person's memories, profile
   or episodes, and `decide()` (`gate/decide.ts`) judges an anonymous speaker at the child band for every effect (a consequential
   capability, or any of the risks `write_household`, `action`, `spend`, `chosen_destination`, `admin`): the parent's say, or never, as
   before a robot had a companion. The robot surface still refuses pictures, video and songs whatever the band.
4. **The reply is composed with the robot's companion**, not the signed-in person's: persona dials and few-shot examples. The robot
   keeps answering to its own name (`robot-own-name-and-memory-2026-10-20.md` decision 3: `robotName` stays the identity name). The
   plan no longer forces `directness: "direct"` on a robot turn that has a companion (that constant forbade every react and question
   back, which is why the robot read flat); the companion's dials decide. With none assigned the old behaviour stands. A web search on
   a robot turn is held to the turn's band as well (the package host took the band from the signed-in person's role alone, so an
   adult's robot searched as an adult whatever the plan said); the stricter of the two applies.
5. **Enforcement.** The settings write for either key refuses a violation with a plain sentence that says what to do. Lowering the
   controls below the assigned companion's type is refused the same way. The turn path re-checks at read time, so a stale pair
   (a reset, an older database) reads as "no companion": child.
6. **Voice.** The companion packages declare no `voice_id`, so speech follows the existing chain ending at the household default
   voice (`tts.home_voice`, else the engine's built-in voice). The clip-voice rule (VOICES-04) is keyed on the turn's band, so a
   child or teen companion on an adult's robot never speaks a clip voice.
7. **Three bundled companions**, one per type, sharing one personality (lively, curious, warm, short for speech, one friendly
   follow-up question when it fits) with five few-shot lines each in age-appropriate words: `lively-child` (Sprout), `lively-teen`
   (Riff), `lively-adult` (Nova). Names are from the persona roster.
8. **Weather for every band** (WEATHER-KID-01; builds on PLACE-WEATHER-01 and WEATHER-HOME-ASK-01, which already name the household home
   fallback and the plain "set the Home location" line, and covers only the unknown speaker). Measured on the live hub's copy: no
   `household.home` is set, and the second try reached the weather tool, which answered "needs a place". The cause is the missing
   household location, and the turn read the signed-in person's own saved place for a speaker it cannot name. An unknown speaker now
   takes the household home, never a personal place, with the turn's band for the rounding of the coordinates (one decimal, about
   11 km, for a child; two, about 1 km, for a teen or adult). No band blocks the weather package. When no home is set the tool still
   says where to set it, and the robot's page in Settings, Devices shows one line pointing to Settings, Home, General (the existing
   location card). That line sits on the robot's own page as a form `Alert` (S6: it is a fact about this setup, not a service state,
   so it feeds no Repairs row).

## Spec

The two robot keys need no spec change: they ride in Home's registry (ROBOT-COMPANION-04 moves them later). The three bundled
companions do change a shared list: `persona.active_id`'s options in the commons registry, tagged `spec-v0.1.201` and pinned here.

## Where the code goes

`backend/src/lib/robotCompanion.ts` (the one definition: controls, companion, band), `settings/robotCompanionKeys.ts` (the two keys,
riding in Home's registry until a spec tag carries them, like `search.brave_api_key`), a gate in `settings.ts`, `turnContext.ts`
(`effectiveBand` takes the device id), `turnMachine/speaker.ts` and the callers, `turnNext.ts` (persona), `voiceForSpeech.ts`,
`nodes/tool.ts` (weather person), three packages under `backend/packages/`, and the Devices page in the frontend.

## Reuse check

No new store, route or status surface. The two keys use the existing device-scope settings (`robot.voice.id` is the model), so the
existing settings routes, admin gate, audit and the frontend's `useDeviceSettings` style reads serve them. The companion list is the
existing `PERSONAS` catalog. The UI is the kit `Select` and `Alert` on the robot's page in Settings, Devices (`HouseholdRobotsSection`,
`RobotBody`); the missing-location pointer feeds the existing `Alert`, not a new banner (S6). Nothing is hand-built that a package
or setting already provides.

## Rule check

- **Rule 0.** Reworded by the owner today (below): a robot with a companion takes the companion's type; every other unknown speaker
  on a shared surface, and a robot with no companion, stays child. Nothing loosens without an admin choosing a companion for that
  robot, and the child lane (topics, hard lines, gate, crisis overlay) is untouched.
- **Rules 1, 2, 5.** No search rule changes. A child or teen companion keeps rule 5's spoken limits and rule 2's thinking off.
- **Rule 9.** Kit Elements as they ship, no className override, no wrapper, tokens only.
- **Rule 14.** Voice stays a per-request mechanism: the companion's voice follows settings; no prose.

## Supersedes

- [modes-and-child-protections-2026-10-17.md](modes-and-child-protections-2026-10-17.md) lines 19, 46, 133 and 174, "an unknown speaker
  on a shared surface still gets the child result", for a robot that has a companion assigned. The sentence stands for a robot with
  none, for the TV and for every other shared surface. A dated amendment is added there.
- [robot-own-name-and-memory-2026-10-20.md](robot-own-name-and-memory-2026-10-20.md) is kept, not superseded: the robot's own name
  stays the identity name when a companion is assigned.
- `turnContext.ts`'s comment and `effectiveBand()` rule "a robot turn is anonymous unless speaker_evidence names the signed-in
  person" as the only input to a robot turn's band (anonymity for memory is unchanged).
- The turn composing a robot reply with the signed-in person's `persona.active_id` (nodes in `turnNext.ts`).

## Legacy verdicts (rule 8)

Nothing carried from legacy. The stock StackChan's lively register ("oh, you're making slushies, that sounds yummy, what kind?") is the
target; the few-shot lines are new, written for the three types.

## Slices

| Id | Size | Exit check |
|---|---|---|
| ROBOT-COMPANION-01 | M | Keys and gate refuse a violation; band, persona and voice follow the companion; unassigned stays child; tests per type. |
| ROBOT-COMPANION-02 | S | Three bundled companion packages with few-shot lines. |
| ROBOT-COMPANION-03 | S | Settings, Devices: Controls and Companion selects on the robot page (only allowed companions listed). |
| WEATHER-KID-01 | S | Weather answers for child, teen and adult from the household home; unset says where to set it. |
