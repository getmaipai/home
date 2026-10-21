# Dynamic companions (2026-10-21)

Owner ruling, chat, 2026-10-21 (Jesse): companions are dynamic by default (they adapt to whoever the robot is set for) and only a few
are explicit. His worry: a companion told to be profane or obnoxious, assigned to a child's robot. Rules in [RULES.md](RULES.md) govern;
one edit to rule 0 is made here under `Owner-approved: 2026-10-21 (chat)`. This supersedes decision 2 and decision 3 of
[robot-companions-2026-10-21.md](robot-companions-2026-10-21.md) (the companion's type sets the band).

## Decision

1. **The band of a robot's turns is the robot's controls level, never the companion's.** An admin sets a robot to child, teen or adult
   controls. A robot with a companion assigned takes that level for an unknown speaker; a robot with none stays child (unchanged). A
   speaker the robot names gets the stricter of their own band and the controls level. A companion never loosens a filter, and the
   child lane (topics, hard lines, gate, crisis overlay, clip-voice floor) follows the band, so a child robot is a child robot whatever
   the companion says.
2. **A companion declares an audience floor** in its manifest, `companion.audience` (commons `spec-v0.1.202`, optional):
   - `all`: a dynamic companion. It adapts its words, topics and tone to the turn's band and may be used on any robot.
   - `teen` or `adult`: an explicit companion. Its own style may be edgier, and it can be picked only on a robot whose controls are at
     or above that level. The backend refuses the assignment (plain sentence), the picker lists only allowed companions, and lowering
     a robot's controls below its companion's floor is refused. A stale pair (a reset, an older database) reads as "no companion",
     the strictest result, as an unassigned robot does.
   - Absent: read from the manifest's `min_role` (child or guest: `all`, teen: `teen`, anything higher: `adult`). The four older
     companions (default, buddy, tutor, pal) all say `child`, so they read as `all` and change nothing.
3. **How an `all` companion adapts.** The persona is resolved against the turn's band before the plan and the prompt are built:
   `examples_<band>` lines come first (topped up from the shared `examples`, four at most), the vocabulary dial is clamped (child:
   simple; teen: at most standard; adult: as declared), and the existing reply plan (`vocabulary_level`, `max_sentences`, content
   ceiling, react and ask_back moves) already follows the band. A companion may add `behavior` lines (style rules, six at most) for
   what the dials cannot say. All text is data in the manifest; the composer only orders and clamps it.
4. **Explicit companions are bundled and reviewed.** Nothing explicit ships today. A catalog companion that declares `all` is held to
   the same review as any package that talks to a child; the band filters still hold if a review misses, but the style is the
   reviewer's to catch. This is why `all` is declared, not inferred from anything the companion says.
5. **Voice.** A companion's voice is a household setting, one key per installed companion (`companion.voice.<id with _ for ->`,
   household scope, the same voice picker values as `tts.home_voice`), because a voice made at home has an id that differs on every
   hub and a package cannot name it. The keys ride in Home's registry, generated from the installed companions (like
   `robot.controls`, until a spec tag carries a key family: item COMPANION-VOICE-SPEC in the backlog). Order for a robot: its own voice (`robot.voice.id` when not default), then its companion's
   voice, then (no companion) the person's voice; the last fallback is Home's default voice. The clip-voice floor follows the band,
   so a child or teen robot never speaks a clip voice whatever was chosen.
6. **Bundled companions.** `lively-child` (Sprout), `lively-teen` (Riff), `lively-adult` (Nova) and the new `rivet` are `all`
   companions with per-band examples. The three lively packages keep their ids (settings and the spec list name them).

## Rule check

- **Rule 0.** Reworded: the band of a robot turn with a companion is the robot's controls level. **Looser than the earlier 2026-10-21
  text for a companion below the robot's controls**: an adult robot with `lively-child` used to answer an unknown speaker at the child
  band (the companion's type) and now answers at the adult band (the controls the admin set). The admin's controls level is the
  ceiling and the owner chose this; the robot's own protections (surface gate, no memory for an unknown speaker, child band for every
  effect in `decide()`) are untouched. For a child robot nothing loosens: only `all` companions can be assigned and the band is child.
  A robot with no companion stays child.
- **Rules 1, 2, 5.** Unchanged; a child or teen band keeps the spoken limits and thinking off.
- **Rule 9.** The picker uses the kit `Select`; no className overrides.
- **Rule 14.** Voice stays a per-request mechanism (settings), not prose.

## Reuse check

No new store. The audience rides in the existing manifest (`companion` block, spec first), the band comes from the existing
`robot.controls` key, voices ride in the existing settings registry with the existing voice validation. The Companions app (another
session) lists the same `PERSONAS` catalog.

## Supersedes

[robot-companions-2026-10-21.md](robot-companions-2026-10-21.md) decisions 2 and 3, and the same wording in RULES.md rule 0 and the
modes note lines 19, 46, 133 and 174 (a dated amendment on line 46; the other three describe an unassigned robot, which stays child).
