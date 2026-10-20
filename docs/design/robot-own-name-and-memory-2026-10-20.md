# Each robot's own name and memory (2026-10-20)

Design note for spec, Home and bot. Rules in [RULES.md](RULES.md) govern; nothing here asks for a rule change. Owner's ask
(Jesse, 2026-10-20): with more than one robot in the home, each robot gets a unique name and its own memories, and the memories of
two robots never mix.

## Supersedes

- `identityLine()` in `backend/src/lib/turnShared.ts` on the robot surface: the robot's name replaces the persona's
  `display_name` in that one line (section "Names").
- `createDevice()` naming for robots: a taken name gets a number instead of a duplicate.
- Recall (`backend/src/lib/memory.ts`): a record bound to a robot is read only on that robot.
- The Forget sentence of [robots-switch-and-install-2026-10-20.md](robots-switch-and-install-2026-10-20.md) section 2 ("This also
  deletes the robot's memories"): this note says which records those are. Same dialog, no new box.

COMP-05 (companion rapport) is unchanged: this note does not use `companion` scope or `companion_id`, which name a companion
persona, not a body.

## Facts (main, 2026-10-20)

- A robot is one Device row, `kind: "robot"` (`backend/src/lib/devices.ts`), id pattern `^device-[a-z0-9]{6,}$`
  (`spec/schemas/device.schema.json`). Its name is `device.name`, set at pairing (`createDevice`, default "A device") and renamed by
  an admin on the card (DEVICES-02). Two robots can have the same name today.
- A robot's session carries its device id (FACE-03, `middleware/auth.ts`), each pairing token is bound to its device (ROBOT-PAIR-02),
  and the turn route can read it (`c.get("deviceId")`), but passes only `surface` and speaker evidence to the engine.
- `memory_records` and the spec `MemoryRecord` have no device field. So every robot reads and writes the same person and household
  memory, and no robot has memories of its own: two robots would share one set of running jokes and one "what we did yesterday".
- The identity line today is `You are ${persona.display_name}, a private, self-hosted AI assistant for this household.`
- The Robots note gives each hub-hosted StackChan its own Bot app and data directory `~/.maipai/home/data/robots/<deviceId>/`, and
  its Forget deletes that directory and "the robot's memories".

## Design

### Names

1. **A robot's name is unique among the household's robots**, compared case-insensitively after trimming. One rule in
   `devices.ts`, used by `createDevice` and `updateDevice`. Rename refuses a taken name with 409 "Another robot is already called
   Rover. Pick a different name.", shown under the name field on the card. Renaming a robot to its own name succeeds.
2. **Pairing never fails over a name.** A new robot whose name is taken gets the first free "StackChan 2", "StackChan 3".
3. **One identity line.** On a robot surface turn, `identityLine()` uses the robot's name in place of the persona's
   `display_name`; nothing else in the line or the persona changes, and there is no second line. A robot that also runs a companion
   persona (COMP-06) keeps that persona's dials and voice and answers to the name on its card, because that is what the household
   calls it. Every other surface keeps the persona's name.
4. Other device kinds keep today's naming. Uniqueness is a robot rule because a robot is spoken to by name.

### Memory

The one store stays one store (principle 1). The spec gains one field, `device_id`, on `MemoryRecord` and `Conversation`: the robot a
record belongs to, null for a record every surface may read. Existing scopes and gates are reused unchanged, so no protection moves.

| Kind of memory | Scope | `device_id` | Who reads it |
|---|---|---|---|
| A fact about a person ("I'm allergic to peanuts") | `person` | null | That person, on every surface and every robot, as today. |
| A household fact ("the dog is called Bruno") | `household` | null | Everyone, with the age gates, as today. |
| The robot's rapport with one person: running jokes, games they played, what they did together | `person` (that person) | the robot | Only that robot, and only when that person is the identified speaker. |
| The robot's own facts: what it likes, its own story, what it did today | `household` | the robot | Only that robot, through the household age gates and `child_disclosure` default, as any household record. |

Telling one robot your birthday means every robot and Home know it; a running joke with Rover stays with Rover and with you.

Mechanics:

1. **Turn.** For `surface: "robot"`, the turn route passes the session's device id to the engine, and the robot's conversation row
   carries `device_id`.
2. **Write.** The memory judge, reading a conversation with a `device_id`, decides per fact: about the person or the home (no
   `device_id`, today's rule), about this robot with this person (person scope plus `device_id`), or about the robot itself
   (household scope plus `device_id`). The household record's `child_disclosure` gets the existing deterministic write-time default;
   the judge never sets it.
3. **Read.** Recall excludes every record whose `device_id` is not the current turn's robot. On a robot turn it reads today's set
   plus that robot's records, through the same `canRead` checks: a person-scope record still needs that person to be the
   identified speaker, so an unknown speaker gets no rapport, an adult's rapport never reaches a child, and Pippa's rapport with
   Rover is absent from Oliver's turn on Rover. Chat and every other surface read no robot-bound record.
4. **Memory page.** Each person sees their own rapport with each robot in their own list, grouped under "Rover's memories". A
   parent sees a child's through the existing `canAccessPerson` path only. A robot's own facts appear with household records, grouped
   under the robot's name, to whoever sees household records today. No new admin view of other adults' rapport.
5. **Forget a robot.** The Robots note's Forget confirm stays one dialog. "The robot's memories" are every record with that
   `device_id` (its rapport records and its own facts) plus `robots/<deviceId>/`. Person and household records with no `device_id`
   stay, because they belong to the people.
6. **The robot without the hub** (principle 2). The Bot app's data directory holds the robot's own records (its `device_id`) and
   what it needs to recognize people, spec-shaped from first boot (bot RT-02), and syncs them with Home by `hlc` when linked. These
   are the same records in two places, merged by the spec's sync rule, never a second schema. A Bot app never receives another
   robot's records.

## Reuse check

Reuses person and household scope with their gates, `canRead`, the `child_disclosure` default, `canAccessPerson`, the session's
device id, the rename route and card, the identity line, and the Robots note's Forget dialog and data directory. New: one nullable
spec field on two records, its column and index, and one recall filter.

## Rows

| Row | Repo | What | After |
|---|---|---|---|
| SPEC-ROBOT-MEMORY-01 | commons | `device_id` (nullable, the device id pattern) on `MemoryRecord` and `Conversation`, its description from this note, fixtures | none |
| ROBOT-NAME-01 | home | unique robot names in `devices.ts`, the 409 copy, the robot name in `identityLine()` on robot turns | none |
| ROBOT-MEMORY-01 | home | pin bump; the column, index and migration; the turn and conversation carry the device id; the judge's three-way rule; the recall filter; the Memory page grouping; Forget deletes the robot's records | SPEC-ROBOT-MEMORY-01, ROBOT-NAME-01 |
| BOT-MEMORY-01 | bot | the Bot app's record store holds only its own `device_id` records and syncs them, with standalone provenance when unlinked | ROBOT-MEMORY-01, RT-02 |
