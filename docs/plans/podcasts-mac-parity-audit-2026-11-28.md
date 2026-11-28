# Podcasts app against Apple Podcasts on the Mac: page audit (2026-11-28)

Reference: eight screens of Apple Podcasts on the Mac supplied by the owner (New, Latest Episodes, Downloaded, Categories, Search/Browse Categories, Show page, Home). Home screens judged: the dev hub at commit 74e9c824 (the live hub's version) at 1440 px. Verdict: Home has the right pages but not the look; every page uses generic kit shelves and lists, where Apple uses purpose-built rows, tiles, cards and a hero. Reference sizes are about 1 px per point on a 1890 px window.

| Page | Apple reference | Home now | Gap | Fix |
|---|---|---|---|---|
| Sidebar | Search, Home, New; Library (Recently Updated, Shows, Channels, Categories, Saved, Downloaded, Latest Episodes); Stations; person at the bottom; 217 px | Home, New episodes, Queue; Discover (Categories, Trending, Recommended); Library (Shows, Episodes, Saved, Downloads, History); Tools (Filters, Stats); search in the header | Different grouping, no Recently Updated, no Settings entry, search not in the sidebar | Regroup nav in the manifest: Search, Home, New, Library group incl. Recently Updated and Settings; keep Discover |
| Home | Up Next as large cards (265 x 355) with resume point and play pill; shelves of 208 px art under titles with chevrons | Hero with no art when a show has none; Up Next as short cards; Latest episodes as a list with two big buttons | Hero fallback grey; cards too small; episode rows wrong | Up Next card primitive; shelves with 208 px tiles; EpisodeRow |
| New | Editorial feature cards (436 x 250) with a label; numbered Top Shows (rank, title, author); New Shows | List of episodes with 130 px tiles | Not a "New" page at all: no features, no ranks | Feature card row from the directory top list; numbered shelf; EpisodeRow for the rest |
| Latest Episodes / Episodes | Rows 120 px apart: 90 px art, "10h ago", bold title, two grey summary lines, play pill with duration, "..." menu, hover highlight | Large art, date and one line, then Add to queue and Mark played buttons | Rows too tall and noisy; no play pill, no menu, no summary | EpisodeRow primitive in the kit |
| Shows / Downloaded | Grid of 208 px tiles with title and "N Episodes" | A single narrow list (one show, or the same show repeated) | No tile grid, no counts | ShowTile grid; counts in the row builder |
| Categories | Four-across coloured cards with icon, name, "N Followed Shows" | Plain text list with arrows | No colour, icons or counts | CategoryCard primitive with a fixed colour and icon per genre |
| Search / Browse | Seven-across coloured category tiles, segmented "Apple Podcasts / Library" | Result shelves | No category tiles; no scope switch | Browse tiles when the box is empty; segmented control for directory vs library |
| Show page | Colour header from the artwork (330 px), art left, title, latest-episode blurb, rating, genre, frequency, play pill with progress and a check; filter and sort buttons; Episodes list "Filtered by: Unplayed" | Square art with the title over it, Follow and Skip settings buttons, then shelves | No header treatment, no meta line, no filter and sort | ShowHero primitive (colour from art, meta line, pills); filter and sort buttons over the list |
| Play / mini player | Floating pill (690 x 52) at the bottom; no side column | Full page player; pill centred on desktop (shipped 2026-11-28) | Close; pill lacks speed, skip back and forward, chapters, queue and AirPlay buttons | Extend pill controls; keep skip toast with Undo |
| Queue, Saved, History | Same row list as Latest Episodes | Same oversized tiles | Same as Episodes | EpisodeRow |
| Settings | Settings live in the app menu, one simple sheet | Hard to find, long, unclear if saved (owner report) | Findability and clarity | In flight: one Settings page with saved-on-change |
| Skip (ours) | none | Player toast with Undo, break list, per-show override | Per-show button went to the global page (owner report) | In flight: open that show's own controls |

## What the kit cannot do today (found in the 2026-11-28 layout run)
90 px art in a row, 120 px row pitch, two summary lines, a play pill with the duration, title text that opens the episode, coloured category cards, and a hero tinted from artwork. These are new primitives in `getmaipai/commons` `ui` (EpisodeRow, ShowTile, CategoryCard, FeatureCard, ShowHero, FloatingPlayer), each tagged and pinned, then the pages switch to them.

## Order
1. EpisodeRow, then Episodes, Latest, Saved, Downloads, History, Queue, New on it (biggest visible change).
2. ShowTile grid and counts: Shows, Downloaded, Home shelves.
3. CategoryCard and Browse tiles: Categories, Search.
4. ShowHero and the filter and sort row: Show page.
5. Sidebar regroup with Settings; Feature cards and numbered rank on New; floating pill controls.
Each step is previewed at 1440, 820 and 375 px before it lands.
