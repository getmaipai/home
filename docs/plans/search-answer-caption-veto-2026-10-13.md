# Answer pictures: caption vetoes for drawings and relatives (SEARCH-ANSWER-09, 2026-10-13)

Architect-checked against `docs/design/RULES.md`: this is media filtering after retrieval in
`backend/src/lib/answerImages/relevance.ts`, not a search or tool decision, so rule 1 is not touched. It only removes
candidates, so rule 0's protections are not loosened.

## Problem

For "show me photos of Michael Jackson" the pictures can include a caricature or a painting, and a photo captioned
"Janet Jackson, sister of Michael Jackson" (a picture of someone else).

## Change

Two additions to the existing closed caption lists, one counter per word (`caption:<word>`), no model call, no new
source of candidates:

1. Art veto: a caption with drawing, painting, sketch, caricature or illustration drops the candidate. Exempt when the
   asked subject text itself contains that word ("drawings of X" keeps them), the same exemption the category stems use.
2. Relative veto: a caption naming the subject as sister, brother, wife, husband, son or daughter "of X", or "with X",
   drops the candidate when the asked subject is X.

## Tests

"drawings of X" keeps drawings; "photos of X" drops them; "Janet Jackson, sister of Michael Jackson" dropped for
"photos of Michael Jackson"; plain "photo of Michael Jackson" kept. Plus a judged sample, every tile opened (rule 13
spirit), recording kept and dropped counts.

## Supersedes

None. IMGQ-04 and IMGQ-10 already veto "drawings" and "sketches" category stems and minors by closed word list; this
extends the same lists and changes no recorded behaviour.
