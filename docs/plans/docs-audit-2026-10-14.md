# Documentation audit and page lists (2026-10-14)

Status: draft for Jesse, nothing written yet. Read-only audit of `docs/user/` against the user-tier rules in
`.github/docs/STYLE.md`, plus proposed page lists for the user, admin and developer tiers and the README.
The docs system (DOCS-GITBOOK-01) is chosen separately; this note does not depend on it.
Counts below come from a keyword scan, so they point at pages to read, not proven faults.

## The three tiers (your description, 2026-10-14)

| Tier | Folder | Reader | Rule of thumb |
|---|---|---|---|
| User | `docs/user/` | A teenager or a dad | Short, one task per page, no technical words. |
| Admin | `docs/admin/` (new) | The technical dad who runs the house | How it works, how to configure it, how to support it. Not for developers. |
| Developer | `docs/dev/` | Contributors | Architecture, design, advanced work. |

Adding `admin/` needs an edit to `.github/docs/STYLE.md` (your word). Two words need to be kept apart:
"admin" here is the docs tier for the person who maintains the hub, and "admin" in the product is a role
the owner gives a trusted helper. The admin guide is written for both the owner and admins.

## What the current user guide gets right

- Page titles are mostly tasks or plain nouns, and 7 of 16 pages end with "Still need help?".
- The tier rules in STYLE.md are already good (one task per page, about 7 steps and 300 words, on-screen labels
  in bold, no routes or env vars). The pages just do not all follow them.
- Seeded-demo screenshots exist in `docs/assets/screens/`, so the capture pipeline is there.

## Findings

1. **Seven pages are over the length rule** (about 300 words of instruction per page): chat 2,075 words,
   web-search 1,937, privacy 1,079, news-shelf 708, blocked-sites 644, memory 613, getting-started 492.
2. **`web-search.md` is an admin page.** It has 35 hits on technical words (SearXNG, server, port, IP address,
   Tailscale) and 19 numbered steps. It fails the dad test by design and belongs in `admin/`.
3. **`engine-computer.md` is an admin page** (pairing, secure addresses, using it away from home).
4. **Route and URL text appears in 11 of 16 pages** (chat has 8 hits). The scan also matches harmless text, so each
   hit needs a read. STYLE.md bans routes and URLs as instructions: name the button instead.
5. **"Simply" or "just" appears in chat (2), memory (1) and web-search (1).** STYLE.md says delete them.
6. **`getting-started.md` has 10 numbered steps**, over the 7-step rule. Some are install steps for whoever
   sets the hub up, which is admin work, not user work.
7. **No front door.** `README.md` is a flat list of 15 links. STYLE.md asks for "How can we help?" with two modes
   (set something up, and **Fix a problem**), a short rail of common questions, and nav groups named in the
   user's words (Start here, Everyday use, Your family, Privacy & safety, Fix a problem).
8. **Privacy is one long page** (1,079 words). The org rule says Privacy & safety is its own top-level group
   with the generated "what leaves the house" view. The user version should be short; the detail is admin.
9. **No admin docs exist.** Setup details, backups, updates, troubleshooting depth and the support runbook are
   either missing or sit inside user pages.
10. **The repo `README.md` is stale.** It says "only runs from source today", links Documentation to
    `docs/dev.md` (a 36,840-line developer record), and lists six features. A visitor who has not installed
    anything cannot find the user guide from the front page.

## Page-by-page verdict

| Current page | Verdict | Why |
|---|---|---|
| `README.md` | Rewrite | Becomes the "How can we help?" front door. |
| `getting-started.md` | Split | First-run steps stay (user). Install and hardware move to admin. |
| `home.md` (125 words) | Keep | Already the right size. Check for route text. |
| `chat.md` (2,075) | Split into about 5 | Send a message; Talk instead of type; Look things up; More on a message and rating; If chat stops. |
| `memory.md` (613) | Split into 2 | See, forget, export (user); household memory and who hears it (user, longer). |
| `people.md` (433) | Split | "Who is in my house" (user). Roles, adding people, children's files and check-ins (admin). |
| `settings.md` (391) | Keep | Plus an admin settings reference. |
| `ease-of-use.md` (306) | Keep | Already short. |
| `notifications.md` (176) | Keep, move Telegram | Seeing alerts stays (user). Telegram setup becomes admin. |
| `privacy.md` (1,079) | Shorten to about 300 words | Detail moves to an admin privacy page. |
| `sensitive-subjects.md` (232) | Keep, under "Your family" | It is a parent's choice, not a technical one. |
| `blocked-sites.md` (644), `news-shelf.md` (708) | Decide | Parent choices about lists. Proposed: a short user page each, configuration detail in admin. |
| `web-search.md` (1,937) | Move to admin | See finding 2. |
| `engine-computer.md` (460) | Move to admin | See finding 3. |
| `fix-a-problem.md` (402) | Keep as the front-door mode | Headings are already conditions ("If it stopped answering"). Add an admin runbook. |

## Proposed user guide (`docs/user/`)

Groups follow STYLE.md. Each page is one task, about 300 words, ends with "Still need help?".

- **Start here:** What MaiPai Home is (one screen, no jargon); Your first minutes (first sign-in and first chat);
  Find your way around (the Home screen).
- **Everyday use:** Send a message; Talk instead of type; Ask it to look something up; Rate or fix a reply;
  See what it remembered; Make words bigger and colors clearer; See your notifications.
- **Your family:** Who is in the house; What each role can do (short); Check in on a child; Sensitive subjects
  for a child or teen; Which sites and news a child sees.
- **Privacy & safety:** What stays in the house; What never leaves; How to forget something.
- **Fix a problem:** "If MaiPai will not load", "If chat does not answer", "If voice does not work",
  "If you cannot sign in", "If a setting will not save", and "Still stuck?" with a path to the admin.

About 20 short pages replace 16 long ones.

## Proposed admin guide (`docs/admin/`, new)

Written for the technical dad. Gives the reasons and the controls, no code internals.

1. How Home works at a glance (the hub, the engine, the Stack, where data lives).
2. Choose hardware and install (current "only from source" state, system needs).
3. Set up the hub in detail (owner, admins, the wizard, what to skip).
4. People, roles and parental controls (the full permission table).
5. Settings reference (household and per-person, what each key changes).
6. Web search: connect SearXNG, choose engines, library vs internet, away from home (from `web-search.md`).
7. Use another computer for the AI (from `engine-computer.md`).
8. Remote access (Tailscale and the secure address).
9. Notifications and Telegram.
10. Blocked-site lists and news feeds.
11. Safety settings for children and teens.
12. Backups and restore.
13. Updates and rollback.
14. Privacy audit: every outside connection, what it sends, how to turn it off.
15. Troubleshooting runbook and how to gather a support report.
16. Packages: install, update, remove.

Items 12, 13 and 15 have no source page today. The facts must come from the code and the existing standards
(`BACKUPS.md`, `UPDATES.md`) and be checked, not guessed.

## Developer tier (`docs/dev/`)

`docs/dev.md` is a 36,840-line design record, not a developer guide. A contributor's front door is a short
map: architecture, repo layout, the gate, how a package is built, how to run the demo household, and links into
the record. Nothing here has to be written before the user and admin tiers are signed off. The one job now is
to stop the repo README linking visitors to `docs/dev.md` as "Documentation".

## README (repo front page)

Keep the brand header and the hero image. Rewrite to: one-sentence promise (verbatim from `brand/COPY.md`),
three-line "what you get", a **Read the guides** row (User guide, Admin guide, Developer guide), install status
stated plainly, and the license. Move the long start, stop and restart block to the admin guide.

## Order of work

1. Sign off this audit and the page lists.
2. Spike the docs system (DOCS-GITBOOK-01): Fumadocs rendering `docs/user/`, with the four checks.
3. Write the user guide, then the admin guide, then the README, with generated screenshots that are opened and
   judged.
4. Jesse reviews and signs off.
5. Expand: the Help package (parked design draft: `docs/plans/help-2026-10-14.md`) and the developer map.

## For Jesse

- Page lists in this note: right grouping, right amount, missing anything?
- `blocked-sites` and `news-shelf`: short parent page plus admin detail, as proposed, or admin only?
- Add the `admin/` tier to the org STYLE.md? You said yes; that edit is in a different repo and is yours to
  approve at the time.
