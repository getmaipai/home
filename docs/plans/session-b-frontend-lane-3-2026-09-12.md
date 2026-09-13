# Session B: frontend lane 3 (2026-09-12)

Work order from the coordinating session. Same rules as
`session-b-frontend-issues-2026-09-12.md`: frontend-only on `main` in
the main checkout while Track A runs in `home-track-a`; ownership is
`frontend/**`, `scripts/screenshot.ts`, `docs/user/**`, `docs/assets/**`,
and your own lines in `docs/BACKLOG.md` and `docs/dev.md`. One
exception, stated here so it is not a guess: item 4 may add an
additive batch route in `backend/src/routes/memory.ts` with its
`lib/memory.ts` helper and tests, because Track A does not own those
files and Track B has merged; nothing else under `backend/`. Never
`scripts/check.sh`. Long commands in the background or with a raised
timeout. Code review at medium before each commit; docs in the same
commit; stage by name; push `main` after each item; report to
`getmaipai-c0` on done (hash, commands and results, evidence paths),
blocked (pasted error), question, or low context. Commit this file
with item 1.

## 1. getmaipai/home#76: a WebKit screenshot run overwrites the Chromium images (S)

`scripts/screenshot.ts` writes every browser's output to
`docs/assets/screens/<name>.png`. Make a non-Chromium run write under
`docs/assets/screens/<browser>/` (gitignored) or write no PNGs unless
`--write` is passed; pick the one that keeps the Chromium path
unchanged and say why. Acceptance: a `--webkit` run leaves `git status`
clean in `docs/assets/screens`; the Chromium run still produces the
published images; the script's own header comment states the rule.
Close the issue from the commit.

## 2. Privacy page: the inbound row's label renders in the wrong place (S)

In the regenerated `privacy-desktop-light.png`, the "Can someone reach
into your house?" section shows a row whose heading is the scope line
("your own network only - nothing leaves the house for this row") and
whose source name ("MaiPai Home itself") dangles as a bare line after
the "How long they keep it" field. Read `frontend/src/apps/privacy/
PrivacyPage.tsx` and the row shape it renders; decide whether the
inbound row's fields are mapped to the wrong slots or the data carries
them that way. If it is the renderer, fix it so the row reads like the
outbound rows (source name as the heading, scope as a field), add a
test for the inbound row's field order, regenerate and open the
screenshot, and commit. If the data is at fault (`backend/src/lib/
privacy.ts`, not yours), write the exact row you got and the shape you
need into your dev.md section and message the coordinator. Either way
say which.

## 3. The narrower contrast finding: message timestamps at 3.66:1 (S)

BACKLOG.md "A second, narrower contrast finding" (UI / shell): axe
reports six `color-contrast` nodes on `chat @ desktop/light`, all the
`<time>` element assistant-ui renders for a message timestamp, computed
`#85858d` where this repo's `--muted-foreground` computes to `#70707a`.
Find where the library's own class resolves to the lighter value (its
own CSS layer, a `text-muted-foreground` alias, or an opacity), fix it
at the kit level so every timestamp measures at least 4.5:1 in both
themes, and prove it with `bun run a11y` (the chat combo) showing zero
`color-contrast` nodes. Also close the "still open" note under
"Reduced motion, type floor, theme colour": hunt the bell badge and
thread timestamp `text-[10px]`/`text-xs` instances and bring them to
the type floor UI.md names. Tick both items.

## 4. Batch select and clear-all on Memory (M)

BACKLOG.md "Batch select and clear-all everywhere else" (UI / shell),
Jesse's standing rule: every deletable list has multi-select, and a
clear-all where the whole list is disposable. People already consumes
`kit/primitives/BatchBar.tsx` and `SelectModeToggle`; Memory does not.
Do: lift `PeoplePage.tsx`'s destructive confirmation panel into the
kit (one component, copy supplied by the caller); give `MemoryPage.tsx`
select mode, multi-select forget (and archive if the page has that
state), and a clear-all with a confirmation that names the count;
wire `lib/memory.ts`'s `forget()` to it. If forgetting N memories
needs N round trips today, add one additive `POST /api/memory/forget`
taking ids (Zod schema, OpenAPI, a route test) rather than looping in
the client; tombstone semantics stay whatever `forget()` already does.
Acceptance: a frontend test per promise (select mode shows the count,
forget removes exactly the selected rows, clear-all asks and then
empties the list); the flow exercised in the browser against the
running backend and a screenshot of select mode opened and judged;
docs/user/memory.md updated with the new actions in dad-test prose.
Tick the item; note Conversations and Notifications still inherit the
rule when they get surfaces.

## 5. Parallelize the screenshot matrix (S)

BACKLOG.md "Parallelize `scripts/screenshot.ts`'s full matrix". One
Chromium process, a small pool of concurrent contexts (start at 4),
same output, same checks. Acceptance: the full matrix's wall-clock
time before and after recorded in your dev.md section; `bun run
screenshots` output byte-identical or the differences explained;
`bun run a11y` unchanged. Tick the item.

## Out of scope

#60 and #55 (after Track A merges), #75 (filed, needs its own
investigation later), the PWA item, anything under `backend/` beyond
item 4's stated exception.
