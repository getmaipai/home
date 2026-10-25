# One minimal phone look for every app, measured against Apple News (2026-10-25)

Jesse, 2026-10-25, after opening News on his iPhone next to Apple News: the News app is "improperly sized, doesn't maximize
layout, super ugly, doesn't add the right controls and content", color theming is wrong, and "we globally need to go to Apple
News design for target items like news article, video, etc. (see how minimal)". His rulings the same day: no favorites star
anywhere (landed), no fade at the end of a button row, button rows must not move up and down under a finger. This note fixes the
phone look once so News, Videos, Podcasts, Books, Shows, Weather, Chat and Home stop being redrawn one app at a time.

Reference: four phone screenshots Jesse took the same minute, Apple News (Today and the reader) against Home's News (Today and
the reader). They are not committed (they show a real outlet and a real person); the measurements below are copied from them.
Everything here is layout, spacing and which controls exist. No gate, age rule or data path changes (rule 0 and the minor floor
stay exactly as the News design note and `RULES.md` have them).

## 1. What Apple News does, measured at a 402 pt wide phone

| Piece | Apple News | Home today |
|---|---|---|
| Top of a feed | One line: the large title ("October 25") in 34 pt bold with the date in the same block; nothing above it but the status bar | A shell bar (menu button, title, settings), then a tab row, then a bordered search box, then the title: about 330 pt before the first picture |
| Section switch | A floating bottom tab bar (Today, News+, Audio, Following, Search), 5 items with icons and labels | A row of pills under the shell bar |
| Topic chips | One row directly under the title, white capsules, no border, 44 pt tall, scroll sideways without a fade | Bordered capsules, 48 pt, the same width of row but with a border and a gap above |
| Lead story | Picture 4:3 filling the card, outlet logo then a 22 pt semibold headline in up to 3 lines, one tinted topic chip under it; no dek on the lead | Picture 2:1, kicker, 28 pt heavy headline, a dek, source row |
| Next stories | Two cards side by side, picture on top, 2 to 3 lines of headline, outlet logo | One wide card per story |
| Card shape | 20 pt radius, no border, a surface one step off the page color, 16 pt gutter | 12 pt radius, 1 px border, 16 pt gutter |
| Reader chrome | None in the page: a round back button and one pill of icon buttons float over the content | A bordered toolbar block and a second block for the source name, both full width |
| Reader text | Outlet logo centered, headline 24 pt semibold, dek 20 pt regular in the muted color, byline 14 pt muted, a Listen pill, then the picture inset 16 pt with a 12 pt radius | Headline 40 pt black weight, no dek visible, picture above the fold |
| Body | 18 pt, line height 1.5, 16 pt gutter, 34 to 40 characters per line on a phone | not measured |

## 2. The rules (apply to every app on a phone)

P1. **One bar, then content.** The shell bar is the only fixed chrome. An app's name and its settings button sit in it (landed,
`packageAppHeaderBar.tsx`). A page never draws a row of its own above its content; the page title is in the scroll flow,
large, and scrolls away.

P2. **An app's sections are a bottom bar on a phone.** An app with sections (News: Today, My Mix, Following, Saved; Videos:
Home, Library, Watch later, History; Podcasts, Books, Shows alike) shows them in the kit's existing `PhoneNav` part (it already
draws a five-entry bottom bar with icon, label and More), extended by additive props: a floating look, an `aria-label`, a
filled active item and one trailing search item. This is the app's own sections bar; the main navigation stays the slide-over
drawer with the app switcher (Home `RULES.md` S1, owner-approved 2026-10-06), and the bar never lists apps. The bar's search
searches only that app's own records (S2: an app never draws a second copy of Search everywhere). On a page that carries the
Listen dock or the companion launcher, the order from the screen edge up is: the bar, then the Listen dock, then the launcher,
and the dock and launcher sit above the bar's height. The top pill row is the desktop and tablet form only.

P3. **Cards are surfaces, not boxes.** 20 pt radius, no border, the card color one step off the page color, 16 pt gutter, an
8 pt gap between cards. Pictures lead (4:3 for a lead, 3:2 in a two-up). A text-only card gets the same radius and padding.

P4. **Two-up from the second story.** The first story of a feed is full width; from the second on, two cards per row when the
phone is at least 360 pt wide. A story with no picture spans two columns as a row.

P4a. **A child's phone is one column.** The News note's kid-mode density holds: one card per row for a child, targets stay 52
and 76 pt, reader text stays 22 pt with "Read it to me", and the floating reader pill has no Share and no Open on site for a
child (Share would hand out the outlet link the News note removes).

P5. **No extra labels on a card.** Outlet mark (the feed's own icon, same-origin) and headline are the card; a kicker only on the
lead; a dek only in the reader; no "min read", no outlet count for a child (the child rules in the News note stay).

P6. **The reader floats its controls.** Back is a 44 pt round button; Listen, Share, Save and More are one 44 pt-tall pill; both
sit over the content, sticky, with the kit's blur surface. Nothing else is chrome. Headline 24 pt semibold, dek 20 pt muted, byline
14 pt muted, then the Listen pill, then the picture inset by the gutter with a 12 pt radius, then the body at 18 pt, line height
1.5.

P7. **A row of chips or pills is one steady strip.** It scrolls on the horizontal axis only (no vertical movement under a
finger, no rubber band on the other axis), has no fade or mask at its end, no visible scrollbar, and every item is at least 44 pt
tall.

P8. **Touch targets are 44 pt.** Where a control draws smaller, its hit area is still 44 pt (the existing invisible
pseudo-element pattern in `chatTouchTargets.css`).

P9. **Theme.** Every surface follows the person's light or dark choice through the kit's tokens; a page never paints one color
by media query and another by class. `first-paint.js` sets the class before first paint, and `theme-debug.html` reports what a
phone resolves (landed 2026-10-25).

## 3. Per app

| App | Change on a phone |
|---|---|
| News | Today: large title, date, topic chips, lead card, two-up grid; search is the bottom bar's last item; the reader as P6. The mockup in `assets/news-app-2026-10-17.html` already has the title and date block; its pill row becomes the bottom bar. |
| Videos, Podcasts, Shows, Books | Sections to the bottom bar; poster grids two-up; the watch page is the picture, then title and one pill of actions, nothing in a bordered block. |
| Weather | Already one bar and a card; the place search becomes an icon in the bar. |
| Chat | One bar: the history toggle, the conversation title and its actions go into the shell bar (today a second row under it). The composer is unchanged. |
| Home | One bar, the greeting as the large title, the cards as P3. |

## 4. Where each change is built (rule 9: kit first)

Nothing here is a `className` on a kit Element. The kit (`getmaipai/commons` `ui/`) gets: additive props on the existing
`PhoneNav` for P2 (no new primitive), a card surface variant (P3) and the two-up grid on `StoryFeed` (P4), phone values of the
tokens NEWS-LOOK-02 already names (the 4:3 lead is a phone value of `--story-hero-ratio`; the reader sizes are phone values of
row 13, 14 and 15's tokens), the floating reader controls on `ArticleView` with Listen staying `Button variant="inverse"` (P6),
the steady strip behavior on the chips and pill rows (P7), and a quiet search entry on the bar. Home then pins the new tag and
removes its own phone workarounds. Each kit change is its own backlog slice with a gallery capture at 390 and 1440, light and
dark, opened and judged. Jesse said yes (2026-10-25) to cutting the commons tags for this work when checks are green. Using
`PhoneNav` in Home needs the org doc `.github/docs/UI.md` ("the `PhoneNav` part do not apply to Home") narrowed to the app
switcher; the owner said yes on 2026-10-25.

## 5. Not in this note

Desktop and TV layouts (unchanged), Key points and Listen playback (NEWS-04), the data routes (NEWS-02), My Mix ranking, and
the voice work.

## 6. Supersedes

Narrows `news-app-2026-10-17.md` section 6a on a phone only. It replaces: the 16:9 hero (row 1) with a 4:3 lead; the kicker on
every card (row 6) with a kicker on the lead only; the hero, featured and half-width grid (difference 2) with one lead then
two-up; the 72 percent shelf tiles with two-up cards; the search box in the header (difference 6) with the bar's search item;
the 28 px article title (row 14) with 24 pt; the reading text of 19 px at 1.65 and 66 characters (row 13) with 18 pt at 1.5; the
16:9 article lead (row 15) with a picture inset by the gutter; and "targets 48 px" with 44 pt (P8). The kid-mode density row stands
(P4a). Desktop and TV layouts, gates and records are unchanged. `RULES.md` S1 is unchanged: the sections bar is an app's own tabs under S2, and the main navigation stays the drawer. The org doc
`.github/docs/UI.md` is narrowed to the app switcher by the owner's yes of 2026-10-25.

Related rows: MOBILE-SWEEP-01 (its "two top bars" finding is fixed by P1 and PHONE-06, not filed again) and CHAT-PHONE-01 (Chat's
phone layout; PHONE-06 and that row point at each other).
