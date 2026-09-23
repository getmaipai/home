# External sharing: one file, one link, served by the house (2026-09-23)

For Jesse. A design record (L), spec first; the owner questions are
numbered at the end. Your words: "you can share a generated picture via
a unique URL."

## The tension this record opens with

"Nothing leaves your house" is the product (PRIVACY.md). This is the
first feature built to let a household record leave the house on
purpose, so the rule is stated before the design: nothing leaves the
home unless a person chooses it, for one file, by their own action; and
no MaiPai-operated service ever sits in the path. The hub itself serves
the link, over whatever the household already exposes to the internet
(its own reverse proxy, its own tunnel, its overlay network), described
here generically and configured by the person, never a MaiPai relay,
never a MaiPai domain, never a copy on a machine the family does not
own. A link is the household's address plus a token; when the household
has no public address, the feature is absent, not degraded. Every link
is a row on the privacy page's "what leaves the house" table: what
leaves is exactly the one file behind the link, when a viewer opens it,
and nothing else.

## The record: a link is a share pointer with a token, never a copy

The household storage record (`household-storage-2026-09-23.md`) makes a
share a pointer record on one file: `file_id`, `from_person_id`, `to`.
An external link is the same pointer with `kind: "link"`: no second file
record, no copy of the bytes, the same owner, the same cap accounting
(the file counts against its owner, a link changes nothing). The share
record gains, spec first (`STORE-SPEC-01` carries it):

| Field | Meaning |
|---|---|
| `kind` | `person`, `household`, or `link` |
| `token` | for `link` only: an unguessable value (at least 256 bits from the platform's random source, encoded for a URL), stored hashed with the secret pepper like a device token, never logged, never returned after creation except once to the person who made it |
| `expires_at` | 30 days from creation by default, "no expiry" as a choice at creation (decision 1) |
| `download_limit`, `download_count` | optional limit; the count is the owner's view log's total |
| `revoked_at` | set by revoke; a revoked link answers not found, indistinguishable from a link that never existed |

One link points at one file; an album is a later row on the same pointer shape (decision 3). Every view
is logged for the owner as a view record (time, the file, the link's id,
the viewer's rough origin as the proxy reports it, never a fingerprint),
shown on the Storage page beside the link, and nowhere else.

## Who may create a link

An adult, for a file they own: always. A child: never (ruling 2 of the
storage record bounds a child to the household until an adult acts; a
link is the definition of outside it). A child's file shared with an
adult: the adult may create a link for it, because ruling 6 lets
anything shared with a person be re-shared within the household and an
adult acting for a child's file is the "until an adult acts" of ruling
2; the child sees the link on their own Storage page with the adult's
name, and the adult's action is logged as a parental action. A file
shared with the household or with a person is not linked by the
recipient: only the owner makes a link, and an adult for a child's file
shared with them (decision 2). Creating a link is a consequential action in the pipeline's terms:
the executor asks once ("Share this picture with anyone who has the
link?") and the answer is a real confirmation, never inferred.

## What the viewer sees

A plain page served by the hub at the household's public address: the
file (an image shown, a video played, a document offered as a download),
its kind and size, nothing else. No account, no sign-in, no household
name, no person's name, no other files, no link to the hub, no script
that tracks, no third-party asset (fonts and styles come from the hub).
The safety floors apply to the served content exactly as in-house: the
image safety check that ran before the file was persisted is the same
one, and a file that would not be shown to the household is not served
to a link either. The page is the template's own empty-state layout with
the file in it; no hand-built UI.

## How the link is reached from outside

One setting, declared once in the registry: `home.public_url`, scope
household, level advanced, default unset. It is the address the
household's own proxy or tunnel exposes (the existing `hubEndpoints`
kinds already distinguish `lan`, `overlay` and `public`; the LAN
`home.base_url` is not it and is never used for a link). The wizard
never sets it and never suggests it; an admin sets it after reading the
privacy page's row for it. While it is unset, the Storage page shows no
link control and the share record refuses `kind: "link"` at the record
API with the reason ("This hub has no public address; an adult can set
one under Settings"). The hub serves the link path only on requests that
arrive for that address through the trusted proxy (`trustProxy.ts`), and
serves nothing else of the hub on that path: the link route is the one
public route, mounted separately, with no session, no cookie and no way
to reach another route from it.

## Backups and the robot

Links are hub-only: the robot never serves one, never holds a token, and
a share pointer of kind `link` does not sync to it; a robot alone has no
public address by design. Backups include the share records and the
hashed tokens as precious state (BACKUPS.md); a restore restores links
as they were, and the owner's page shows them so they can be revoked
after a restore if the person wants.

## Threats, and the mitigation for each

| Threat | Mitigation |
|---|---|
| Enumeration (guessing links) | 256-bit tokens, a constant-time lookup on the hash, a per-address rate limit on the link route with a long back-off, and a not-found answer that is identical for wrong, expired and revoked tokens |
| A leaked link (forwarded beyond the intended person) | expiry and a download limit as the owner's choices at creation, revoke as one action on the Storage page, and the view log so the owner sees the views they did not expect |
| A revoked link cached by a viewer | the page is served with no-store headers and the file with no long-lived cache; what a viewer already downloaded cannot be recalled, and the page says so at creation ("anyone with the link can save the picture") |
| A child pasting a link elsewhere | a child cannot create one; a link an adult made for a child's file is on the child's page with the adult's name, revocable by either; a child's own page never shows a token |
| The link route as a way into the hub | a separate mount with no session, no cookie, no other route reachable, served only through the trusted proxy for the public address |
| A view log that becomes tracking | the log holds time, file, link and the proxy's origin only, is the owner's, is never sent anywhere, and the served page carries no script |

## Rows (in the household storage area)

- `SHARE-LINK-01` (commons, S, spec first, inside `STORE-SPEC-01`'s
  tag): the share record's `kind`, `token` (hashed), `expires_at`,
  `download_limit`, `download_count`, `revoked_at`; the view record;
  fixtures in both languages.
- `SHARE-LINK-02` (home, M): the link route as its own mount, the token
  hashed with the pepper like a device token, constant-time lookup, the
  identical not-found, expiry and the download limit, revoke, the view
  log, the rate limit; the record API refusing `kind: "link"` without a
  public address and for a child; the confirmation as a consequential
  action.
- `SHARE-LINK-03` (home, S): the viewer page from the template's
  empty-state layout, the safety floor on served content, no-store
  headers, no third-party asset.
- `SHARE-LINK-04` (home, S): `home.public_url` declared once, the
  Storage page's link controls (create with expiry and limit, copy once,
  revoke, the view log), the privacy page's row.

## Decisions (owner, 2026-09-23)

1. A link expires after 30 days by default, with "no expiry" as a choice
   at creation.
2. Only the owner makes a link from a file, and an adult for a child's
   file shared with them; a recipient inside the household does not make
   a link from a file shared with them.
3. A link points at one file; an album is a later row on the same
   pointer shape (a list of file ids on one pointer, the same token rules).
