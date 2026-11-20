# Place and prop look sheets through the Stack (PLACE-SHEET-01e)

Capturing the look of a place or a prop (`captureLook`, `backend/src/lib/castLook.ts`) can build the reference sheet with the Stack's `character_sheet` job instead of Home's one sheet builder: the Stack makes several views of the place or prop (kind `place` or `object`) and composes one sheet (`compose: true`).

Dark by default. It runs only when all of these hold:
- `MAIPAI_LOOK_SHEET_VIA_STACK=1` is set,
- the subject is a place or a prop,
- the Stack's catalog lists `character_sheet` as available and names `compose` in its request fields (an older Stack does not).

Otherwise `captureLook` builds the sheet with `films/sheetMaker` exactly as before. A character is never sent to the Stack path.

What stays Home's: who may capture a look (the cast rules in `castLook`), the age check and the finished-picture gate on the composed sheet (`checkImages` then `gateFinished`, kind `picture`) before it is stored or shown, and every plain line. A gate refusal, a gate that errors, a Stack refusal, a sheet still running and a missing composed file all end the capture and store nothing (fail closed). A picture that is not adult-only is made on the Stack's all-ages list (`audience: "minor"`), like every Home picture (rule E6).

Code: `backend/src/lib/stackLookSheet.ts` (the maker, with a test seam), `makeSheetJob` and `fetchStackPicture` in `backend/src/lib/pictures/stack.ts`. Tests: `backend/tests/stackLookSheet.test.ts` with a fake Stack.

Not done: no real run (the sheet takes a few minutes of picture work, which waits for the GPU), so the flag stays off. The Stack cannot resume a sheet that outlasts its wait, so a slow sheet reads as "could not be made"; the person can try again. The composed file is held in the Stack's memory store until Home fetches it, which happens straight after the sheet is made.
