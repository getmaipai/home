# The People page as a creator page, phase one (2026-09-26)

For Jesse. This is the design pass `docs/dev.md`'s "Design pass over the
reserved items (Fable, 2026-09-26)" named as startable now: PEOPLE-01
phase one, account holders only (pets and known people stay
`PEOPLE-EXPAND-01`, per your 2026-09-25 ruling). Your ask: each person
gets a page like a short-video app's creator page, picture, what they're
sharing, subscribable; the People page becomes a creator directory; the
person can customize their own page. The questions that are yours to
rule on are numbered at the end.

## Where the metaphor holds and where it doesn't

A creator page works because a creator is a stranger the viewer chooses
to let in. A household member isn't a stranger: everyone in `/api/people`
already has each other's name, role and shared files, and today's People
page (`frontend/src/shell/pages/PeoplePage.tsx`) already lists the
whole roster to anyone signed in, unscoped, by design. So the parts of
the metaphor worth keeping are the browsing feel (a grid of pictures, not
a table of names) and the page shape (a picture, a line in their own
words, a grid of what they've shared). The part that doesn't transfer is
the gate: a creator page's subscribe button controls who sees anything at
all; nothing here should. Visibility inside a household is already
governed, by role (a child's page hides what wasn't shared with them) and
by the share pointer (`docs/plans/household-storage-2026-09-23.md`'s
`to: person | "household"`), and neither of those should get a second,
competing gate bolted on top. Section 6 reinterprets "subscribe" on that
basis, and asks you to confirm it.

## What Person is missing today

`spec/schemas/person.schema.json` has `display_name`, `role`, and
`avatar_seed` (explicitly "never a photo of a real person by default" -
a real decision already on the record, not an oversight). It has nothing
for a picture, nothing for a line of self-description, nothing for a
page's own look. Three additive fields, spec first, same pattern
`nickname` already uses (optional, nullable, package-invisible unless
named):

| Field | Type | Meaning |
|---|---|---|
| `avatar_file_id` | `string \| null` | A `file` record (`STORE-SPEC-01`) the person owns, `kind: image`, standing in for `avatar_seed` when set. Unset means the generated avatar, never a placeholder photo. |
| `bio` | `string \| null`, max ~160 chars | The line under the name, in the person's own words or (for a child) a parent's. Plain text, no markdown, no links - this is a look-in for the household, not a bio field a package or the assistant ever writes to. |
| `accent` | `string \| null`, enum of a small named palette | The one page-level customization that isn't free text (section 5). |

None of these change who may read a `Person`; they change what's on the
record, which is why they go through the spec before the frontend
touches them, same as every shared shape.

The avatar_seed comment already deferred the real work: `Avatar.tsx`'s
own header says the DiceBear-rendered avatar is deferred "until the
shell's profile picker is built." This is that moment. Phase one doesn't
have to build DiceBear rendering to ship a picture-driven page - the
initial-on-tint fallback still works fine as the *no-photo* state - but
the deferral is worth closing here rather than carrying it past another
redesign; named as its own row below (`AVATAR-RENDER-01`), not blocking
this item.

## The directory: a grid, not a table

`PeoplePage.tsx` today stacks two of the vendored dashboard's own
views (its own header comment: "one route, two of the template's own
views stacked exactly as the Step 1 stand-up first mounted them") - the
signed-in person's profile card, then `DataTable` rendering the
roster as rows of name/role. The table was the honest placeholder for a
stand-up, not a design; this replaces it. The directory becomes a grid of
cards, one per household member: `Card` (`@maipai/ui/src/dashboard/
components/ui/card`), the avatar (or photo) large, name, role label,
`bio` if set, sized so it reads as a grid on desktop and a single column
on phone (the same responsive rule as everywhere else - one design,
`feedback_mobile_same_design.md`). No new primitive: `Card` in a CSS
grid is the whole component. The signed-in person's own card leads the
grid (keeps today's "this is you first" framing) rather than sitting in a
separate block above it, which also removes the double avatar the
current stacked layout has (their name shows twice today: once above the
table, once as a row in it).

Tapping a card opens the profile page, same route pattern
`PersonProfilePage.tsx` uses today (`/people/:id`).

## The profile page

Composed from the vendored `UserProfile`'s own shape (`commons/ui/src/
dashboard/components/user-profile/index.tsx`), not the component itself
- its header comment on `PeoplePage.tsx` already worked out why:
`UserProfile` takes no props, everything is local hardcoded `useState`
(email, phone, position, social links, address, a local-only Edit dialog
that never reaches a server), and none of those fields exist on `Person`.
Editing it to accept props would be forking a vendored file, which the
org rule rules out. What's reusable is the *shape* - a header `Card`
(avatar, name, a subtitle line) - and the *pattern* - `Dialog` + `Input`
+ `Label` + `Button` for an edit action - both already shipped, both
already used elsewhere in this repo the same way.

The page:

1. **Header card.** Photo or avatar, `display_name`, role label
   (`ROLE_LABELS`), `bio`. Owner-or-self sees an Edit action here (the
   `Pencil` + `Dialog` pattern `UserProfile` already demonstrates):
   change the bio, change the accent, opt into a real photo. This
   replaces `DisplayNameSection.tsx`'s current home in Settings ->
   Household -> Users for name changes only if you want it there instead
   (open question 3) - the safer default is to leave display-name editing
   where `PEOPLE-EXPAND-01`'s own history says it already had to move
   once (self-service naming, 2026-09-15) and add bio/photo/accent
   alongside it in the same place, rather than splitting one person's
   editable fields across two pages.
2. **Shared media grid.** What this person has shared with the viewer or
   the household - `STORE-SHARE-01`'s share pointers, `file_id` resolved
   to its record, filtered to `to: viewer.id OR to: "household"`. This is
   the one real gap: **no gallery or media-grid component exists yet**,
   not in this repo's frontend and not in the vendored `dashboard/`
   snapshot (checked both). Per the org's own rule for exactly this
   case, the gap is named, not hand-waved past: the smallest composition
   of shipped parts is a `Card`-grid of `AspectRatio`-boxed thumbnails
   (both already vendored, `ui/src/dashboard/components/ui/aspect-
   ratio.tsx`), opening into a `Dialog` for the full image/video - no new
   primitive, no new library, three components already in the kit
   composed together. Filed as its own kit row (`MEDIA-GRID-01`) because
   `STORE-PAGE-01`'s Storage page and any future Photos/Videos app want
   the identical grid - built once in `@maipai/ui`, not once per caller
   (platform principle 1).
3. **Manage actions** (owner/admin viewing someone else, or the household
   management surface) stay exactly where `PEOPLE-EXPAND-01`'s backlog
   entry already put them - Settings -> Household -> Users - never
   duplicated onto the profile page itself. The profile page is for
   looking at a person, not administering one.
4. **The child-view rule.** A child viewing an adult's page (or anyone
   viewing a child's) sees the same header always (photo, name, bio -
   none of that is sensitive) but the shared-media grid applies the exact
   same share-pointer filter as the Library view: nothing appears that
   wasn't shared with that viewer or the household. This isn't a new
   rule invented for profiles, it's `STORE-SHARE-01`'s own disclosure
   filter read from a second surface, which is the point of it living at
   the record layer instead of per-page.

## Customization, bounded

Everything customizable is a `Person` field or a settings key, never
page-level CSS or a layout choice - the same reason `UserProfile`'s own
hardcoded fields can't just grow more of them, and the same reason a
"theme your page" feature would break the one-look-from-tokens rule the
moment two households render the identically-named page differently for
no functional reason. What a person can actually change about their own
page, phase one:

- **Bio** - the one line, edited inline via the header card's Edit
  dialog.
- **Photo** - opt in to a real picture in place of the generated avatar
  (never the reverse default; see decision 1 for a child).
- **Accent** - one of a small named set (5-6 values) added to `tokens.css`
  alongside the existing single `--accent` token, the same shape
  light/dark already uses, applied to that person's header card and
  avatar ring only, never to shared chrome (the app's own light/dark
  stays exactly what it is everywhere else). Not freeform color, not a
  hex input - a picker of named swatches, so the palette stays something
  the kit owns and reviews, not something a person's raw input renders
  as one-off CSS.
- **Pinned shares** - reordering or pinning specific shared items to the
  top of their own grid (a preference on the share pointer or a small
  ordered list on `Person`, decided when `MEDIA-GRID-01` lands - doesn't
  need deciding now).

Nothing here is a settings-registry key in the `SETTINGS.md` sense
(three disclosure levels, generic renderer) - like `display_name`
before it, these are `Person` fields with their own small hand-composed
edit surface, not household-wide settings a renderer walks.

## Notified on sharing, no subscribing at all (Jesse 2026-09-26, revised)

Retired, not just reinterpreted: there is no subscribe action anywhere in
this design. Jesse's second pass on this cuts it further than the first -
notifications for a share are on by default for everyone they reach, and
the only control surface is Settings -> Notifications, where a person
mutes what they don't want, the same shape every other configurable
notification type in this app already uses
(`backend/src/lib/notificationTypes.ts`). No subscription list, no
per-viewer opt-in row, no new audience concept: `NotificationAudience`
already has exactly the two values this needs, `"person"` and
`"household"` (`notificationTypes.ts:22`), sitting right next to the
`share.schema.json` pointer's own `to: person_id | "household"`. Two
declared types, not one, since a type's audience is fixed at declaration
(every existing type picks one):

- `file.shared_with_you` - `audience: "person"`, fires to the pointer's
  `to` when it names a person directly.
- `file.shared_with_household` - `audience: "household"`, fires to
  everyone when the pointer's `to` is `"household"`.

Both `passive` (matching `memory.updated`'s posture - nothing needs
attention right now, it's there to notice whenever), both
`configurable: true`. That configurability is what "turn off for family"
already buys for free, no new mechanism: the existing per-type settings
key (the same shape `notifications.<typeId>.telegram` already is) turns
`file.shared_with_household` off for someone who finds every household
share too noisy, while `file.shared_with_you` stays on.

The one piece that's genuinely new is "per person" - muting shares from
one specific household member while still hearing about everyone else's,
which today's per-type toggle can't express (it's on or off for the
whole type, not filtered by who triggered it). That's a small, real gap:
a settings key holding a list of muted sender ids
(`notifications.file_shared.muted_senders`, read by the trigger before
it dispatches, filtering that sender out of that viewer's recipients)
needs a person multi-select control the generic settings renderer
doesn't have yet (checked: no such control exists anywhere in this
frontend today). Named here rather than skipped: the smallest correct
version ships as its own small settings-registry addition once
`file.shared_with_*` exists, not blocking the household-wide mute, which
needs nothing new at all.

## Explicitly out of scope, phase one

Pets and non-account people (`PEOPLE-EXPAND-01`, its own design pass,
its own Entity-storage prerequisite). Anything outside the household
(no public pages, no discovery, matches the product's "nothing leaves
the home" promise directly - a creator page's whole premise is being
found by strangers, which this must never do). Follower counts or any
other vanity metric - nothing here is a number to grow. Free-form
page theming beyond the named accent set.

## Rows (chunked once the decisions below land)

- `PEOPLE-SPEC-01` (commons, S): the three `Person` fields above, the
  fixture and round-trip test, tag bump.
- `PEOPLE-GRID-01` (home, M): the directory as a card grid, retiring
  `DataTable`'s roster table; depends on nothing else.
- `PEOPLE-PROFILE-01` (home, M): the profile page's header card, the
  Edit dialog (bio, photo opt-in, accent), the manage-actions link-out;
  depends on `PEOPLE-SPEC-01`.
- `MEDIA-GRID-01` (commons, S): the shared `AspectRatio`-card grid plus
  lightbox `Dialog` in `@maipai/ui`, built once for this page,
  `STORE-PAGE-01`, and any future Photos/Videos app.
- `PEOPLE-PROFILE-02` (home, M): the shared-media grid on the profile
  page wired to `STORE-SHARE-01`'s pointers with the child-view filter;
  depends on `MEDIA-GRID-01` and `STORE-SHARE-01`/`STORE-PAGE-01`
  (real prerequisite, not busywork - there's nothing to grid before
  sharing exists).
- `AVATAR-RENDER-01` (commons, S, not blocking): the deferred DiceBear
  avatar rendering `Avatar.tsx` already named; closes the gap between
  `avatar_seed` and an actual generated picture instead of an initial.
- `NOTIFY-SHARE-01` (home, S): the two declared types
  (`file.shared_with_you`, `file.shared_with_household`) in
  `notificationTypes.ts`, on by default, the existing per-type toggle
  giving "turn off for family" for free; depends on `STORE-SHARE-01`
  (nothing to fire on before a share pointer exists).
- `NOTIFY-SHARE-02` (home, M, not blocking): the per-sender mute list
  and the person multi-select control it needs, the one real gap named
  above; ships after `NOTIFY-SHARE-01`, whenever picked up.

`PEOPLE-GRID-01` and `PEOPLE-PROFILE-01` need no storage prerequisite and
can start now; the media grid and the share notifications wait on
`STORE-SHARE-01`/`STORE-PAGE-01` same as `PEOPLE-01`'s backlog entry
already says.

## Decisions (owner)

1. ~~**A child's real photo.**~~ **Resolved, Jesse 2026-09-26: admin
   confirms.** A person on the supervised/limited role (today's `child`
   value, pending `ROLE-RENAME-01`) can propose a real photo, an admin
   confirms it before it's visible, same shape as an inferred entity
   needing confirmation.
2. ~~**Subscribing.**~~ **Retired, Jesse 2026-09-26: no subscribe concept
   at all.** Notifications on a share are on by default, controlled only
   in Settings -> Notifications (household-wide mute for free from the
   existing per-type toggle; a per-sender mute named as `NOTIFY-SHARE-02`
   above). See "Notified on sharing, no subscribing at all" above.
3. ~~**Where display-name editing lives.**~~ **Resolved, Jesse 2026-09-26:
   moves to the profile page.** Display name joins bio/photo/accent on
   the profile page's own Edit action, one place for one person's
   editable fields; Settings -> Household -> Users drops the field
   (2026-09-15's placement retired, not left as a duplicate).
4. **Sequencing.** Start `PEOPLE-GRID-01`/`PEOPLE-PROFILE-01` now (no
   prerequisite) while `STORE-SHARE-01`/`STORE-PAGE-01` are still ahead
   of them, so the page exists and looks right before the media grid
   lands on it - or hold the whole phase until storage is further along
   so nobody sees an empty grid in the meantime.
