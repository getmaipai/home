# Incognito: a hub-wide, throwaway-account session (2026-09-24)

For Jesse, from a long design conversation the same day as the
suggestions safety note (`.github/docs/SAFETY.md`'s new suggestions
invariant, this same date). Not built. Everything below is a proposal
to confirm, not a decision yet - unlike this repo's usual dated
records, nothing here is landed or ruled on. This is a clean rewrite of
several earlier drafts in the same conversation; it supersedes them
rather than patching alongside them.

## Why

The existing "Temporary chat" toggle (`CHAT-WELCOME-01`, gated to
non-minor roles) is per-conversation, settable only when starting a
new chat - "temporary-chat has nothing to do with an EXISTING
conversation's actions at all (it starts a NEW one)," per its own code
comment. Two real gaps follow: you cannot drop into privacy
mid-conversation, and a temporary chat's own thread title still sits
in the visible thread list for as long as the hub is shared - someone
glancing at the device sees the title even without opening it.

## The model, settled

**Logging into a throwaway guest account, on the whole hub, not just
chat.** Not a browser-incognito analogy anymore (that model kept
downloads and bookmarks) - a macOS Guest Account analogy: no access to
your existing history or memory while it's active, and everything the
session touched is gone the moment it ends. One clean promise, no
asterisk.

- **Person-scoped, not device-wide.** Home already knows the acting
  person on every request; Incognito is that person's own state for
  their session on this device.
- **Hub-wide, not chat-only.** MaiPai Home is several catalog apps
  (chat, Videos, Music, later Podcasts) sharing one household session.
  Incognito is a shell/session-level flag every app reads the same way
  it already reads an age band or a capability - never chat-specific
  plumbing on `conversationHistory.ts` alone.
- **No memory, reads or writes, while active.** `policy.ts` already
  refuses `memory:write` for temporary conversations today - that half
  exists. The read half is new: nothing accumulated in the person's
  normal life surfaces during an Incognito session either, matching
  "logging in as a stranger."
- **The companion is disabled outright, not just memory-less -
  simpler, and reuses an existing mechanism.** An earlier draft kept
  the companion's personality active without its memory; Jesse's own
  call is to turn it off entirely instead, which is both simpler to
  build and more honest (a companion normally built on continuity
  appearing with none of that continuity is its own kind of confusing).
  `NextChatPage.tsx` already has `ADMIN-COMPARE-01`'s "bare mode" - the
  persona/voice layer stripped, the bare-floor reply served as-is,
  today used for comparison/measurement. Incognito reuses that same
  mechanism rather than inventing a second way to turn the companion
  off.
- **Generated content stays normally visible during the session, and
  clears when the whole mode switches off - not per item, not hidden
  away while active.** Refined from an earlier draft that read as
  "nothing shows up unless you download it immediately," which was
  the wrong shape. The real model, from the Images app as an example:
  the app's own "your generated content" tab works exactly as normal
  while Incognito is on - everything made this session is right there,
  browsable like any other time. The **sharing tab is locked out
  entirely** (see the sharing/social point below). What's different is
  only the lifetime: the moment Incognito switches off, everything
  that tab is showing from this session is gone. **Downloading is the
  only way to make something survive past that exit** - a deliberate,
  explicit action any time during the session, moving the file outside
  MaiPai's own data model entirely, onto the person's own device.
  Someone who wants to make something private and keep it in MaiPai's
  own Library long-term should generate it outside Incognito instead,
  where the ordinary ownership model (`PEOPLE-01`, `STORE-SHARE-01`:
  private to its owner by default, visible to someone else only
  through an explicit share pointer) already protects it without
  Incognito's involvement.
- **Sharing and social features are disabled outright, not just
  unpersonalized.** A step further than "don't record activity":
  Incognito makes the person effectively anonymous to the household's
  shared systems, so anything inherently social - sharing a file with
  family, a multi-person Channel (`CHANNELS-01`), posting AI-generated
  content for the family (a podcast, anything published) - doesn't
  make sense from a throwaway account and should be unavailable, the
  same way a macOS Guest Account can't reach another user's shared
  folders. **One shared guard, not a per-feature reimplementation** -
  the exact shape `meetsMinRole` already has ("one definition... read
  at every site"): every sharing/social/publishing route checks the
  same Incognito flag the way it already checks role, so a new social
  feature is safe by construction the day it's added, not by whoever
  remembers to add the check.
- **Every package declares its own Incognito behavior on its manifest
  - required, no default, enforced the same way `CAP-GATE-01` already
  enforces capability requirements "for every package kind under the
  one manifest."** Not a pile of ad-hoc booleans scattered per package
  - a small closed set of behavior classes, the same shape `min_role`,
  `permissions`, and `consequential` already are:
  - **`blocked`**: unavailable entirely while Incognito is on (sharing,
    `CHANNELS-01`, anything that publishes for the family).
  - **`ephemeral`**: works normally, but nothing it writes persists
    past the session - the chat/`conversationHistory.ts` shape, and the
    Images app's generated-content tab.
  - **`unaffected`**: doesn't touch personal data or write any history
    to begin with, nothing to gate (a stateless lookup with no
    personalization or memory input).
  A package that doesn't declare this field fails to install or fails
  CI - never a silent fallback to whichever behavior seems safest,
  because "seems safest" is exactly the kind of judgment call that
  drifts wrong over time without a human catching it. Spec first, per
  the org's own rule for shared record changes (`manifest.schema.json`
  in `commons`), then the host's one shared reader every route and
  install check calls, mirroring `meetsMinRole`'s and the capability
  gate's own pattern exactly.
- **A separate thread list while active**, matching a browser's
  private window (its tabs never show in the normal window's bar):
  Incognito threads never appear in the normal thread list, at any
  point, and the normal thread list is unavailable while Incognito is
  on - not merged, not toggled between within the same view.
- **Stays on until manually switched off - no duration cap needed
  anymore, and no forced wipe on idle either (corrected 2026-09-25,
  Jesse's own call).** With nothing persisting by default, the earlier
  worry (weeks of accumulated Incognito content sitting around)
  doesn't apply - there is no accumulation to worry about. The
  live-session risk (someone walks away mid-session with active
  Incognito content on screen) is covered by a **session lock with PIN
  re-entry**, not a timeout that force-exits and wipes: the session
  stays live and its content stays intact, just locked behind the PIN
  until the right person re-enters it. **Admin-configurable per
  account** - a household can require the lock for some people and not
  others (an adult, yes; a child's own account, not required). This
  replaces the single-idle-timeout mechanism an earlier draft of this
  doc proposed; no second "hard cap from creation" timer either, same
  as before.
- **Visual design: three signals, never color alone.** A small badge
  is easy to miss from across a room; the real requirement (someone
  glancing at the screen who isn't the one holding it) needs something
  ambient. Three parts: a colored **border/frame around the content
  area** (not a full background recolor - that reads as obnoxious over
  a long session); a fixed, always-visible **icon plus the word
  "Incognito"** (never color alone - basic accessibility practice,
  and bad lighting or a more severe color vision deficiency than the
  common red-green kind can defeat a color-only signal); a distinct,
  always-visible **toggle**, never buried in a menu. Purple is a
  reasonable color: red-green color blindness generally still leaves
  blue/violet distinguishable, unlike red-green or blue-yellow pairs -
  verify real contrast in both themes before picking the token, same
  as any other themed color. Skip a custom cursor: easy to miss,
  meaningless on a touchscreen (this is a household hub, not
  desktop-only), reads as a glitch rather than intentional design.
  Cheap to build: the shell already has a dark/light theme-token
  mechanism (`data-theme`); an `incognito` variant is a new value on
  infrastructure that already exists.
- **Entry: one-time explanation, never repeated. Exit: state-aware
  warning, never fixed.** Mirrors the existing unrestricted-mode
  precedent (`.github/docs/SAFETY.md`: "a single clear dialog... no
  legalese ceremony, never repeated"). Turning Incognito on explains
  what it means once, first use only, silent every time after. Turning
  it off warns only when there is something live to lose right now (an
  open thread, unsaved generated content) - the browser-tab-close
  pattern, gated on real state.
- **Personalized suggestions follow the mode.** Normal mode's new-chat
  suggestions stay generic always (the safety note's default);
  Incognito's own suggestions may draw on the current visible turn -
  never on memory, search history, or an inferred profile, the safety
  note's hard floor, unchanged by the mode. Generalizes past chat: "no
  personalization from Incognito activity" is one rule, true for a
  video recommendation row exactly as a chat suggestion chip.
- **Replaces `CHAT-WELCOME-01`'s per-chat toggle** outright, per the
  owner's own framing. The per-chat control retires once Incognito
  ships - not a second, parallel way to get the same thing.

## What already exists, and is most of the foundation

`backend/src/lib/conversationHistory.ts` already has an in-memory,
never-DB-backed temporary-session store (`temporarySessions`, a
`Map<conversationId, session>`) already holding more than one
concurrent temporary conversation - "multiple private threads" is
already true at the storage layer. It already auto-expires idle
sessions (`TEMPORARY_SESSION_IDLE_MS`, two hours today) and caps the
process-wide total (`TEMPORARY_SESSION_MAX`, 200). `isTemporaryConversation()`
is the one signal other callers already read. `policy.ts` already
refuses `memory:write` when `state.temporary` is set.

Missing: a session-level mode above the per-conversation flag (marks
every new conversation temporary automatically, drives the UI into a
separate view, drives locking on a session-lock event rather than an
idle wipe); the memory *read* half (new); the download-to-keep flow
for generated content (new); the shared sharing/social guard (new,
mirrors `meetsMinRole`); **the session lock + PIN re-entry mechanism
itself (new) and its per-account admin setting** - likely a generally
useful primitive beyond Incognito (a household may want session
locking on a shared device regardless of mode), worth checking whether
it should be built as a standalone capability Incognito adopts rather
than Incognito-specific plumbing.

## Settled since the first draft (2026-09-25)

Three of the original five open questions below are now answered,
Jesse's own calls: **no forced wipe on idle** - a session lock with
PIN re-entry instead, admin-configurable per account (see "The model,
settled" above); **entering Incognito mid-conversation always starts
blank**, no offer to continue context privately; **minors are allowed
by default**, no adult-only floor inherited from Temporary chat (a
real change from today's behavior - this needs its own look at
`NextChatPage.tsx`'s existing role-vs-birthdate gating gap, since
"allowed by default" for Incognito while chat itself still gates
Temporary chat to non-minors is a real inconsistency to resolve, not
just leave standing).

## Open questions for the design pass

1. Whether the session-lock + PIN mechanism is Incognito-specific or a
   standalone capability Incognito adopts (see above).
2. Whether `TEMPORARY_SESSION_MAX` (200, process-wide) needs its own
   accounting once Incognito can hold several threads per person -
   likely fine at household scale, worth a sanity check rather than
   assumed.
3. The exact list of routes the sharing/social guard must cover
   (`STORE-SHARE-01`'s share pointers, `CHANNELS-01` once it exists,
   any future "publish for the family" action) - an inventory to build
   as each of those features itself gets designed, not guessable now
   for features that don't exist yet.

## Next step

Needs its own BACKLOG row(s) once the open questions above have
owner's answers, sized realistically (genuinely L: touches conversation
storage, the turn machine's memory read/write gating, the thread-list
UI, a new download flow, and a new cross-cutting guard every
sharing-shaped feature must adopt). Not chunked into rows yet.
