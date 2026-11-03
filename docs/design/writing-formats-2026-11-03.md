# Writing formats, first slice (2026-11-03), revision 3

Status: current, architect APPROVED 2026-11-03 (revision 3). Research: `data-scratch/reports/writing-app-research-2026-11-03.md` (private).
Revision 3 answers the architect verdicts on revisions 1 and 2 (`data-scratch/architect/WRITING-FORMATS-01.verdict`, REJECTED twice: delivery path, 16-tool cap, bench row, adult length lines).

## Verdict on existing writers (principle 8)

Documents (`write_document`), the projects runner, stories, video prompts and music style cards each build their own
"how to write X" path. Slice 1 touches none of them. It adds one shared place for "how to write X": a format, a
`kind: "skill"` package (existing shape, no new record, no spec change). Reuse check: the only skill today is `storytime-style`;
`loadAllSkills()` has no turn caller, so no existing path delivers a skill to chat (this is the gap the slice fills). No community
skill covers email or card writing; none was found in the catalog.

## Delivery path (rules 1, 4)

No word-overlap routing. One virtual tool, `writing_format`, registered in `VIRTUAL_TOOL_REGISTRY` (`backend/src/lib/projects/tool.ts`),
like `start_project`. Three touch points, as that file's header lists: `toolSpecFor` (`turnMachine/nodes/model.ts`), `policyNode`
and `toolNode`.
- Offer: `mode: "conditional"`, gate `writingFormatAllowed` (added to the closed list in `offerPassesGate`: a written turn, not bare,
  and the person's role may use at least one installed format), `bench_row: "writing-format"`. Not a base tool (the base set stays ten).
- Args: `{ format: <enum of installed format ids> }`, rebuilt on every call like `startProjectToolSpec`. The description lists each
  format's id and one-line description so the model picks by name and description, at most 600 tokens by `countTokens`.
- Per-person limit: `min_role` is enforced in `policy.ts` as `start_project` is (`:314`): a child's call for `format-email` is refused
  with a plain message and the model writes without it. The description may still list it; that is accepted because it leaks only a name.
- Place in the cap: `writing_format` goes first in both shrink orders (`MUSIC_SHRINK_ORDER` and `STUDIO_SHRINK_ORDER`; the music order runs first when `edit_video` is in the set), so it gives way
  before any other tool. A test walks every `withTurnToolGates` combination and asserts the count is at most 16 and that no combination
  throws `exceeds the model cap` because of this tool.
- Result: the format's SKILL.md body. Formats carry structure and tone only and no length hints at all, so an adult turn never receives
  a length instruction (rule 5); child, teen and spoken limits stay where they are (`replyMaxTokensFor`).
- A failed tool never fails the answer (rule 6): on error the model writes without the format.
- Installed formats: skill packages whose manifest has `contributes.writing_format: true` (the manifest schema allows it; declaring
  the key in `commons/spec` is a later, additive follow-up, not part of this slice).
- Bench: `backend/scripts/bench/tool-calling.ts` gains a `writing-format` dataset: calls on writing briefs, no calls on the CHAT-AB-01
  fresh set, websearch decisions unchanged with the tool present, measured on the fresh set's held-out split with at least 3 repeats and paired 95% intervals (rule 13). A second, quality check: 10 fixed briefs with and without the format.

## Content rules for a format

- A format manifest does not use `routing.examples` (do not copy `storytime-style`'s manifest blindly).

- Structure and tone only. No word, sentence or length counts (rule 5). No reading level; the person's `ease.reading_level` wins (rule 13).
- `storytime-style` is not reused as a format (its fixed sentence count breaks rule 5 for adults).

## Slice 1

- Catalog first: `format-email` (min_role teen) and `format-birthday-card` (min_role child) land in `getmaipai/catalog`, then are copied
  into `backend/packages/` with `scripts/refresh-bundled-packages.ts` and listed in `bundled-provenance.json`. Not hand-written in Home.
- Home: the `writing_format` virtual tool and its offer, gate, policy check and shrink position, as above.
- Out of scope: Voices, Proofread cards, Sources, audio overview, editor, Coach mode, spec or commons change, `write_document` changes,
  gates, RULES.md.

## Acceptance

- With both packages installed, a fixture-model turn "write a birthday card for my aunt" offers `writing_format`; calling it returns the card
  format text; with no format installed the tool is absent.
- Cap test over every `withTurnToolGates` combination: at most 16, no throw. Description at most 600 tokens.
- Minor floor: a child's call for `format-email` is refused; a child turn still passes the output gate.
- Bench rows recorded in the commit (tool decision and quality), per rule 13.
- Existing skills, toolOffers and chat-turn tests stay green.

## Supersedes

Nothing removed. Because both formats ship bundled, every household's written turns gain one conditional tool (in the stable tools block,
so the cache prefix is stable from turn to turn). It gives way first under the 16-tool cap, so no existing tool is dropped before it.
