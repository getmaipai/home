# Changelog

All notable changes to MaiPai Home. Format follows
[Keep a Changelog](https://keepachangelog.com); versions follow semver.
Everything stays `0.x` until the product passes its battle-tested
checklist (`docs/dev.md`). The first release is 0.1.0.

## [Unreleased]

## [0.2.28] - 2026-10-19

News pages are laid out per topic, articles show their own pictures and read like Apple News, and the News title says where you are. Chat keeps what you read when the safety check cuts a reply. No database migration. Pins: `@maipai/spec` 0.1.188, `@maipai/ui` 0.5.294.

### News
- **Each topic page has its own layout**, as Apple News does for its categories. World, Business, Sports and Kids open on Top Stories: three tall cards, three cards with the picture on the right, then a list. Science, Health and Environment open with two large cards, then two picture-right cards. Local, Technology and Entertainment open on Today's News, with a wide More for you card. A source you follow keeps the lead card and list.
- **Articles show their own pictures and captions** for teens and adults. Ads, promo and related blocks, tracking pixels, tiny icons and a second copy of the lead picture are left out, and the pictures come through the hub, never from the publisher's address. A child's article stays text only.
- **The article page reads like Apple News.** A slim toolbar has Back, Text size, Share, Save and More (Open original, Listen, Key points), and the text sits in a serif reading column. A story card's menu says Open original.
- **The News title says where you are** (Today, My Mix, Saved, the topic or source you picked) instead of always reading News, and the page no longer sits hard against the sidebar column.

### Chat
- **A reply the safety check cuts keeps the words you already read**, with the refusal line under them, so reloading the chat shows what the screen showed. The hub log now names the safety category that cut a reply (never the words).
- Person removal now uses the numbered picture boxes to understand phrases such as "the boy on the left" before asking the picture model. Its fallback accepts valid answers even when the engine ignores the JSON schema, uses the shared empty-length retry, and logs a reason code without the request text.
- Made pictures have a visible **Edit** action below them; failure guidance now says to tap the picture, then Edit.
- Always-visible **Edit** on sent attachments and a stacked 48 px retry action need additive kit props. Home cannot reshape either kit Element under rule 9; these are tracked in IMGTOOLS-10 and IMGTOOLS-11.
### Library
- Removed the desktop Library title band while keeping the phone menu clearance.
- Added owner-only Origin links from a file to its chat and exact turn. Deleted chats show as plain text; opening a missing turn lands at the end with a note.
- Selection color consistency still needs a shared-kit change. `FileTile` uses `ring-primary`; `DataTable` uses `bg-primary/10`.

## [0.2.27] - 2026-10-19

The Library is rebuilt like a files app: a collapsible sections column, a grid and a list, search and filters, selecting several files, a viewer, sharing, Trash with Restore, rename and Keep, and drag and drop upload. Large uploads (up to 500 MB) are streamed to disk, an adult owner can re-check a mislabeled adult-only picture, and new pictures, videos and songs follow the storage rules. No database changes. Pins: spec-v0.1.187 and ui-v0.5.287. The engine is unchanged.

### Added
- The Library page is rebuilt like a files app: a section column (All files, Pictures, Videos, Songs, Documents, Shared with me, Shared by me, Only me, Trash, with counts, hide and show, Settings and your storage at its foot), real thumbnails, grid and list views, search, Mine, sorting, selection with Share, Keep and Delete, a full-screen viewer with details, sharing with people in your home, Send through your device's share sheet, Trash with Restore, Upload with progress cards, and drag and drop. The view is kept in the address, and `/files?file=<id>` still opens one file. See `docs/user/library.md`.
- The phone menu drawer can list an app's own sections (the Library's) under the apps.

## [0.2.26] - 2026-10-19

News gets fixes for what you reported: the full article opens, pictures show at the right size, each story sits under one topic, the sidebar stays put and pages stop flashing. The Library gets follow-ups to its listing and uploads. No database changes. Pins: spec-v0.1.187 and ui-v0.5.287. The engine is unchanged (Stack a89e7ff).

### News
- **The full article opens.** Stories from The Guardian showed only a one-paragraph summary ("Continue reading..."), because Home's page requests sent no name and The Guardian refused them with HTTP 406. Page reads now name Home honestly, as every other request does.
- **The picture at the top of an article shows**, and cards whose pictures had collapsed to nothing are fixed (a height cap had replaced the ratio the picture frame needs).
- **Each story is under one topic, and the right one.** Every feed now names one topic, and Home reads each story's words and moves it only when another topic clearly fits better (a games piece in a health feed now goes to Entertainment). Grist and The Guardian's wildlife feed are added to Environment.
- **The sidebar stays in place** with its own scroll while the page scrolls, and the app is titled News (its first page was called Today). The page's own section tabs hide beside the sidebar on wide screens.
- **Moving between sections no longer flashes the panel.** Every page of the app is fetched once up front, a page keeps what it showed until new stories arrive, and a loading skeleton only appears if loading takes longer than 200 ms.
- **Section pages (a topic or a source) lead with one wide story and a list**, so they no longer repeat Today's grid. The publisher banner on an article is a slim bar.

### Library
- Your own files with no shares can be listed on their own (the Only me filter), and counts and bytes use the same filter as pages.
- Uploads stream to disk in 8 MB chunks for files up to 500 MB, with cleanup if one is cancelled or fails.
- An adult who owns an adult-only picture can recheck it with the picture check. Only a confident safe result makes it all-ages; a failed check keeps it adult-only, with rate limiting and an audit log.
- New generated pictures, edits, videos and songs follow the storage rules until you pin them with Keep. Existing items and pins are unchanged.

## [0.2.25] - 2026-10-18

News gets a sidebar on wide screens, its pictures are sized and sharper, and stories open to the full article more reliably. One database migration (0120) moves personal API tokens into a new key store. Pins: spec-v0.1.187 and ui-v0.5.281. The engine is unchanged (Stack a89e7ff).

### News
- **A sidebar on wide screens, like Chat's.** The left column holds the News search, Today, My Mix (teens and adults), Saved, every topic you can open, the sources you follow and a Manage link. Choose a topic or source to see its stories. The section tabs give way to it on wide screens; a phone keeps the tabs and the menu drawer. Children see only what their pages allow. The page's own search box hides beside it, except on the search results page.
- **Pictures are the right size.** A tall portrait picture no longer stretches its card (Safari drew it at its own height). Pictures are cropped to their frame, the top story is wider and shorter, and every picture has a height cap.
- **Pictures are sharper.** When a feed lists the same picture at several widths Home uses the widest, and BBC pictures are asked for at 976 pixels instead of 240.
- **Stories open to the full article more reliably.** Home's page requests share one pace, and a story opened while Today was still looking up pictures was refused and then remembered as failed for 30 minutes, so it showed only the feed's summary ("Continue reading..."). It now waits a moment for its turn and tries again on the next open.
- **Fast Company and Inc. are removed** from the News feeds: both refuse Home's page requests, so their stories could only show a summary.

### Keys
- **One personal key store with scopes.** Personal API tokens now live in one `api_keys` table with scopes and peppered hashes, replacing `person_api_tokens`. The migration keeps each token's expiry, a voice token keeps its 365 days, and minors' limits apply. (CODE-KEYS-01)

### Settings
- The Coding settings sections stay hidden until they are built (CODE-SET-01).

## [0.2.24] - 2026-10-18

The Library gets its engine: files are stored once, generated pictures, videos and songs stay in the Library when their chat goes, deleted files wait in Trash for 30 days, and files can be renamed, kept, uploaded and previewed as thumbnails through the API. The song card in chat shows its cover art. News gains topic feeds. Three database changes (stored-once files, Trash, file names), tested on a copy of the live database first. The Library page itself is not redesigned yet. Pins: spec-v0.1.184 and ui-v0.5.277. The engine is unchanged (Stack a89e7ff).

- Added News topic feeds (NPR, BBC, The Guardian, CBC News, Sports Illustrated, Popular Science, Fast Company, Inc., Variety, and TIME for Kids for children). Each feed carries the topics it covers, so every topic on the Following page now has stories. Teens and adults follow every topic until they unfollow one, and each household can change the starting topics for each user type in News settings. Local has no feed of its own; add your town's feed under Extra news feeds.

- Changed how the shelf asks one publisher for several feeds: one at a time, a minute apart, in the same 15-minute check, so a new install fills every topic within about 30 minutes instead of hours.

- Changed the News reader to open with the publisher's name in a banner and a centered article column.

- The Library listing shows which of your files Home will remove after a storage warning, and when. (LIBRARY-RETENTION-PREVIEW-01)
- Pictures, videos and songs Home makes stay in the Library when the chat they came from is deleted or expires; only the Library's storage rules can remove them. (LIBRARY-REVAMP-02)
- Files can be added to the Library from the API without a chat (pictures, videos, songs, documents, text). Children are asked to get a grown-up. (LIBRARY-REVAMP-11)
- Library files can be renamed and kept (pinned) through the API; a kept generated picture, video or song is never removed by storage rules. (LIBRARY-REVAMP-12)
- Deleting a Library file now moves it to Trash for 30 days. While it is there nobody can open it, shared or not; Restore brings it and its sharing back. Another person's copy of the same file is never touched. (LIBRARY-REVAMP-10)
- Children can no longer share files, and an adult-only file cannot be shared with the whole home, a teen or a child. (LIBRARY-REVAMP-04)
- Identical files are stored once. Two people who save the same picture each keep their own copy; Home keeps one file on disk and removes it only when the last copy, chat or share is gone. Storage counts identical files once. (LIBRARY-DEDUP-01)
- Added private Library thumbnails with access-checked revalidation, a disposable WebP cache, stored video posters and song covers, and admin preview usage and clearing endpoints.

- Added the backend Library listing and summary with cursor paging, filters, derived names, generation thumbnails, folded versions, sharing summaries, and audience checks. Storage and Library now classify PDFs and office files as documents.

- Changed the News reader to open with the publisher's name in a banner and a centered article column (ui-v0.5.277).

- Changed how the shelf asks one publisher for several feeds: one at a time, a minute apart, in the same 15-minute check, while other publishers go in parallel, so a new install fills every topic in about 30 minutes instead of hours.

## [0.2.23] - 2026-10-18

A phone gets a round menu button and slide-over drawer instead of the icon rail below 640 px wide, shared adult-only Library files stay away from children and teens, and admins can set Library storage rules by type. No database changes. Pins: spec-v0.1.183 and ui-v0.5.276. The engine is unchanged (Stack a89e7ff).

### Phone
- **A phone shows a menu button, not the rail.** Below 640 px the icon rail is gone; a round button at the top left opens a drawer with Home, Search, your apps, Settings and your profile. Pages no longer run wider than the screen. (MOBILE-RAIL-01, ui-v0.5.276)

- Admins can set Library storage rules by type and preview cleanup. Home warns in Notifications and Repairs at least a day before removing old unpinned generated files. Kept files stay, and chat retention stays separate. Trash days are saved for the later Library Trash feature. (LIBRARY-RETENTION-01)
- Shared adult-only and unclassified Library files are hidden from children and teens, including content and derived image reads. (BUG-LIBRARY-SHARE-CHILD-01)

## [0.2.22] - 2026-10-18

A large release: music that is as long as its words with covers and sing-along lyrics, News search and a Today tab refresh, the content-protection foundation, kept Library files that survive chat deletion, role-only age bands (no birthdate is used), and a photo checker and short model calls that no longer run out of room for reasoning. Pins: spec-v0.1.183 and ui-v0.5.274. The engine is unchanged (Stack a89e7ff).

- People creation and editing ignore legacy birthdate input, require no date, and never change roles on birthdays. (BIRTHDATE-REMOVE-01, first part)
- Non-streaming completion budgets now reserve compulsory reasoning centrally, retry empty length stops once, and report exhaustion as a failure. (REASONING-RESERVE-01)

- Photo checks reserve reasoning room, retry an empty or truncated answer once, and safely read JSON from models that do not enforce its schema. (PHOTO-CHECK-01)

### Content protections
- Age bands now follow the person's role only; birthdate does not change the speaker's band. Remaining date uses are tracked in BIRTHDATE-REMOVE-01.
- Added the shared content policy module, band defaults, reviewed data and offline tests. Consumer wiring follows in later slices. (CONTENT-POLICY-01)

### Library
- Kept files and their music and picture records survive chat deletion and nightly retention. New generated pictures and videos stay in the Library. (BUG-LIBRARY-KEPT-01)

### Music
- **A song is as long as its words.** Full sings every part and is the default; Quick sings the hook. You can ask for a length. Words are cut only to that length or the computer's limit, and a squeezed ending gets one longer try. (MUSIC-GEN-21)
- Every song gets a cover picture when pictures are available and allowed. (MUSIC-GEN-19)
- **Sing along on the song card.** **Lyrics** lights the line being sung. Tap a line to jump there. (MUSIC-GEN-20)
- **The song card shows while the song is made.** It appears as soon as chat starts the song, with its stage, time left, a bar and Stop, and "Paused while chat is working" while chat answers. It used to appear only when chat finished its reply. (MUSIC-GEN-18)
- **A quick song sings only the words that fit.** Long words used to be squeezed into the last second of a quick song and sung as nonsense. Now a quick song sings the first whole parts that fit, the card shows just those words, and **Make it full** sings every part. Lines the engine squeezed into an older song are left off its card. (MUSIC-GEN-17)

### Licences
- Licences: the setup page Before you start now says, in its existing item Home goes online for you, that you also accept the licences of the AI models and tools Home installs. Home keeps one household record of that (who, when, terms version, which licences). A covered licence, such as the Detailed video model, installs without its own accept click; a new or changed licence still asks once. A Home set up earlier shows one prompt in Repairs and Models and storage to accept once, then one button to install the recommended extras (about 74 GB, never started by itself). New household setting install.recommended_auto_on_upgrade (off). LICENCE-ACK-01.

## [0.2.21] - 2026-10-18

A small News release: a shelf's channel button now opens the channel, News's first tab reads Today, and the guides are refreshed. The engine is unchanged (Stack a89e7ff). Pins: spec-v0.1.179 and ui-v0.5.268 (News thumbnail rows keep their padding). Migrations: none since 0.2.20.

### News
- **A shelf's channel button opens the channel.** On Today and My Mix, the button on a shelf's heading now opens that channel's page.
- **News's first tab reads Today.** It was "Overview"; the page is the day's stories.
- **Thumbnail rows keep their padding.** Story rows with a picture no longer sit against the edge.

### Documentation
- User guides refreshed for 0.2.18 to 0.2.20: the settings page name, the cartoon controls, the slow-job note and the Detailed video licence.

## [0.2.20] - 2026-10-17

Quick and full songs, chat that is never slowed by a job being made, and a child-safety fix for the screen-time player. The engine is rebuilt from a newer Stack (a89e7ff). Migrations: none since 0.2.19.

### Safety
- **Child-safety fix: screen time now pauses the player (affects releases since v0.2.18, which said it did).** When a child's or teen's daily media minutes run out, the player in Videos, Music, Podcasts and the small player now pauses within about 15 seconds (up to a minute when the app is in the background), even for a video that has already loaded, and shows "Screen time is done for today. Ask a grown-up for more." once. Pressing play again pauses it right away until a grown-up adds minutes. (The 0.2.18 notes said this already happened; before this fix only new loading stopped.)

### Music
- **Quick and full songs.** Songs now come in two kinds, like pictures and videos. Quick songs are about 45 seconds and take under a minute; full songs are about 3 minutes with an intro, verses, chorus, bridge and ending, and take a minute or two (a Mac with 128 GB). Chat makes a quick song unless you ask for a whole or full song; the card has **Make it full** and **Make it quick**, and **Settings** has a **Song length** choice.

### Reliability
- **Chat is never slowed by a picture, a video or a song being made.** While you chat or talk to Home, the job that is being made waits ("Paused while chat is working") and carries on when the reply is done. Before, a video could cut a reply to less than half its speed for two to four minutes. The wait is not counted against the job.

## [0.2.19] - 2026-10-17

A child-safety fix for media, songs made in chat, and a fix for chat answers that were cut off before the first word.

### Music
- **Songs in chat.** Adults can ask chat to write and make a song (words, style, mood, length) and change it by asking: slower, a new chorus, instrumental, longer, another style, cut, fade, louder, or another take. Each change is a new version you can step back to, and the card plays the song with its lyrics, Download and Share. Songs are made on this computer with ACE-Step 1.5 (about 15 to 30 seconds for a minute of music) and nothing is sent anywhere. Children and teens cannot make songs. The music model is an optional download in **Settings**, **Models and storage**, on a Mac with 64 GB or more. See docs/user/songs.md.

### Safety
- **Child-safety fix: approved media only now holds everywhere (affects releases since v0.2.15).** When a grown-up turns on "Approved media only" for a person, the media apps hid the rows made for them, but the files and some lists could still be reached. Now every media read honours the approved list, not only the app pages: a guest sees only the home library, the next-video suggestion and every suggestion row (Featured, New, Recently added, More from, Music radio picks) are empty for a teen or an adult who has the switch on, as they already were for a child, and a child or teen never sees a shared playlist whose name is not for them. The list of media sources shows a child, a teen or a guest only the name, kind and a count of what they may open: no folder path, no archive of deleted titles, no scan details, no feed address and no creator.

### Reliability
- **A slow chat answer is no longer cancelled after a minute.** A hidden one-minute timer started when you sent a message and stopped the answer if the model had not finished, which cut off a slow first word. The timer now starts only after an answer ends, and never stops one that is running. If the chat engine drops out before the first word, an adult's written message waits up to a minute for it and tries once more.

## [0.2.18] - 2026-10-17

News, Podcasts and Music apps, a daily media time limit for children, and Detailed video from a picture.

### News
- **A News app.** Open **News** from your apps for Today, Following, Saved and a story reader, built on the same news shelf Home uses when you ask for headlines. Teens and adults also get **My Mix**, which learns from your own reading on this hub, can be reset, and can be switched off. Children get stories from the Kids' lists only, their reading is never used to learn interests, and every story is checked before a child sees it. Settings, News holds the reading choices.

### Podcasts
- **A Podcasts app.** Follow shows, listen now, stream an episode or save it on the hub, and import a list of shows. Saved episodes follow the same age and access rules as other media, and a removed episode goes to the Trash for 30 days.
- **Podcasts review fixes.** Saved episodes and show pictures cannot bypass age or show access through Files, including old household shares. Downloads stream to disk within storage caps; keep rules run in a background queue, one run per show. OPML imports use the normal polling limit, and a News address conflict cannot stop Podcasts checks. Only a copy's owner or an adult admin can unsave it; removed copies go to Trash for 30 days. Removing a show cleans up its picture. Old http episode links use https, enclosure downloads allow five redirects, and the privacy text covers automatic downloads, file hosts and the home's IP.

### Music
- Music app: derived albums and artists, songs, liked songs, local radio, your own queue and playlists (New playlist, Add to playlist). Album, artist and playlist pages open with a Play, Shuffle or Start radio header; lists use the kit's grid, round artist art and compact rows. Chat artist lookup is kept.

### Media library
- **A daily media time limit for children and teens.** An owner or admin sets the minutes for a person, and when time is up the player stops and the file stops loading. A child sees "Screen time is done for today. Ask a grown-up for more." Admins get one notice a day, and can add minutes until midnight.
- A grown-up can limit a child or teen to approved sources only.
- "Keep on this device" now has one shared path for apps to use. Media uses it first, with the same browser storage and device protections. Settings, Devices labels copies by kind and clears them together. News stories, reference pages and chat exports are still open.

### Pictures and videos
- A picture can start a Detailed video when the Stack says it can, and the first frame shows while the video is made.
- Detailed videos (LTX-2.3, longer clips with sound and speech, about 74 GB) are now part of the Recommended plan on a Mac with 128 GB of memory. The setup wizard checks the row by default, shows the maker's licence (free under 10 million dollars of yearly revenue; the model's own markings stay) and waits for you to accept it before anything downloads. Untick the row to skip it; the total and the free-space check update at once. The Recommended free space on that Mac is 145 GB (was 61 GB). An upgrade never downloads it by itself: it shows as "Recommended, not installed" under Models and storage with an Install button. Teens and children still get Quick videos only.
- Fixed: pressing Download what's missing with Detailed videos ticked did nothing you could see. The licensed download now starts before the answer, so a refusal from the engine shows as the red message in the engine's own words, and the page says right under the button what happened (started, nothing to download, or why it is waiting for the licence accept). A child's cartoon switch now sits on the child's own Limits tab in People; the home switch and the daily limits are in Home settings, Pictures and videos.

### Safety
- A setting a grown-up holds for a child (News My Mix, where stories open, and the digest) can no longer be changed by the child.
- The Thinking mode button meets the 48 px touch size.

### Reliability
- The Stack is updated to the build that fixes Detailed video from a picture, music model loading, and test leaks. Upgrading never downloads Detailed videos by itself.

## [0.2.17] - 2026-10-17

Detailed videos with sound, media you can keep on a device for offline play, and a smaller default install.

### Pictures and videos
- **Detailed videos, with sound and speech.** Videos now come in two kinds, the same two words as pictures. Quick is the short silent clip (5 seconds, about two minutes, can start from a picture) and stays the default. Detailed makes a sound track with spoken words in the same pass, up to 10 seconds, in about a minute or two, from your words, with many more styles to add. Ask chat for talking or sound ("make a video where the hero says come with me"), or a length past 5 seconds, and it picks Detailed. Each card offers **Make it Detailed** or **Make it Quick**, and **Settings**, **Pictures and videos** has a Video quality choice and **Get Detailed videos** (74 GB) which shows the maker's licence in plain points for an owner or admin to accept once. Detailed videos need a Mac with 128 GB, are never in the first-run plan, and stay off until someone gets them. Finished videos of either kind are still checked before they are shown, with five frames for a long one, and the sound is stored untouched.

### Media library
- A paired device can keep media for offline play when a grown-up allows it. The permission starts off for every device, a removed device or a changed password ends it, tokens are left out of backups, and Chrome and Edge keep the copies in the browser (iPhone and iPad use Go). Files that need conversion are not supported yet.

### Storage
- The chat AI is always llama.cpp unless an admin chooses otherwise. The faster oMLX chat engine (about 20 percent quicker to answer, less reliable with tools in our tests) is an optional install, never fetched on its own. The Recommended plan needs about 61 GB free instead of 85 GB.

### Reliability
- The Stack is updated to the build that adds Detailed video and keeps llama.cpp as the default chat engine.

## [0.2.16] - 2026-10-17

Stronger protection for children and teens in pictures and videos, a Videos app, a Trash for deleted media, and health checks that restart a stuck engine.

### Safety
- Words that try to hide a request about a child (letter-spacing, dots, look-alike characters, other languages) are read the same as plain words. A picture this home did not make is checked before it is edited, animated or used as a reference, and a teen or child is never shown anything nude or sexual. A teen or child who trips a word rule with a harmless request reads one friendly line, and admins are told.
- Teens can make pictures and videos and edit pictures in their lane. Children can make cartoon pictures and videos of safe subjects, 20 pictures and 5 videos a day by default, counted in a stored daily record. A child or teen never sees a half-drawn frame, only gets the Quick video model, and cannot claim a stranger's photo as their own. Every edit is in the admins' activity list.

### Videos
- A new **Videos** app plays the videos saved on your hub, in a dark look like YouTube. Tabs: Home (a big picture, Continue watching, Recently added, more from what you watch most, Watch again), Library by channel, Watch later and History. A video resumes where you stopped, shows Up next, and a finished video leaves Watch later. A child sees only the videos cleared for children and no lists of new videos.
- The Pick up shelf's media links open the video in its app. One video plays at a time, and its speed and the sleep timer follow the audio settings.
### Podcasts
- New Podcasts app: Listen now, Shows, Episodes, Queue and Saved. New episodes play right away from the show's website; Save on the hub keeps a copy that plays with the internet off. Admins follow shows and can bring their list from another app with an OPML file; Home checks each show about once an hour and asks only for what changed. A child sees only episodes cleared for children, and never an explicit one.

### Storage
- Storage now has one Trash for deleted media, playlists and watchlists. Restore an item within 30 days, or confirm Delete forever. Home clears expired items at startup and every six hours; deleted paths stay out of new scans. Children see only their own safe items. Lists and memories will join later.

### Reliability
- Home runs plain health checks in the background (hello, weather, search, a picture, embeddings, voice, a spoken turn). When the AI engine is dead or hung, never just slow, Home asks the Stack to restart it, at most once every 30 minutes.
- The Stack is updated to the build that accepts those restart requests.

## [0.2.15] - 2026-10-17

Chat looks things up for live-status questions, and pictures can be edited in words from chat.

### Chat
- A question about whether a service is down right now ("is cloud flare down") is searched instead of answered from memory. A typed "cloud flare" finds "Cloudflare", and a search the model started but did not finish is recovered as a search.
- Live voice no longer ends a call in the middle of a sentence when its quiet-window timer fires late.

### Pictures and videos
- Edit a picture in words from chat: remove people, remove the background, upscale, change the sky, the colour or an object, or add a person from a second picture. The result is the next version of the picture.
- When an edit leaves people in the picture alone, they are restored from the original and checked unchanged. If Home cannot account for every person in the picture, it refuses the edit instead of guessing.
- Whether a photo shows an adult who agreed is decided only by what the person says in their own message, never by the model's guess. A new household setting, Settings, Pictures, turns off the extra questions and warnings about people. It is off by default, and the safety rules for children and for real people never turn off.

### Reliability
- The web app loads its pages on first visit instead of all at once, so the first download is smaller.
- The Stack is updated to the build that repairs tool names the chat engine mangles and carries the media service and the music engine (no page uses them yet).

### Media library
- A paired device can keep media for offline play when a grown-up allows it. The permission starts off for every device, a removed device or a changed password ends it, tokens are left out of backups, and Chrome and Edge keep the copies in the browser (iPhone and iPad use Go). Files that need conversion are not supported yet.
- Child controls use approved media sources by default. Media now has one daily budget across kinds and screens, protected settings, same-day admin extensions, saved places after time runs out, explicit masking tests, and a private time-up notice. The player hook is ready; app player wiring, allowed hours and ask-a-grown-up actions are still open.
- Child controls use approved media sources by default. Media now has one daily budget across kinds and screens, protected settings, same-day admin extensions, saved places after time runs out, explicit masking tests, and a time-up notice that names the child or teen to the admins (no title or activity). Time-up also stops the file download for a minor, a client that ticks once a minute is counted fairly, and a minor with a limit cannot keep media offline. The player hook is ready; app player wiring, allowed hours and ask-a-grown-up actions are still open.
- Home can scan library folders on this computer or on a mounted network share and list what is in them: videos, shows, films, music, books and audiobooks, with posters, covers, chapters and tags. An owner or admin adds a folder and can rescan it; children see only the titles cleared for a child. No page uses it yet.
- Home remembers where each person stopped in a video, episode, podcast, audiobook or book, on every screen. The newest place wins, a finished title stays finished, and a child's place is saved only from the child's own screen. Liked, watch later and up next exist for everyone, and playlists, watchlists and pins can be made. The "Pick up where you left off" data now includes unfinished titles beside chats.

## [0.2.14] - 2026-10-17

Conversation mode speaks a real answer again. Pictures and videos can look like a household adult who agreed, and the AI engine restarts itself after a crash.

### Fixes
- Conversation mode on the Muse Glimmer chat engine only said "One sec" and then nothing. The model spent the whole spoken reply thinking before it wrote an answer. A spoken reply now skips that thinking, and the short "One sec" cue waits for a late answer instead of replacing it.
- The Voice page always lists the voice in use as Default voice. A saved voice the speech engine does not offer is set aside with one plain line and moved to Default once, instead of being sent to the engine.

### Reliability
- When the AI engine stops by itself, it now restarts itself, with a short wait between tries and a stop after repeated crashes. Admins get one notification when that happens, and the Status page counts it.

### Pictures and videos
- A style, a picture or a video can look like an adult in the household, only when that adult turned on both likeness switches for themselves. Both switches are off for everyone until then. A child, teen or guest cannot turn them on, and a person who leaves the household or leaves the adult age band stops being usable. A photo you attach must show exactly one adult and nobody who looks under 18.
- Settings, Pictures can add a style from a file path on this computer, because most community styles are larger than the upload form allows.
- Z-Image Turbo stays an optional picture maker you choose by name; FLUX.2 Klein is the default on every computer.
- Picture and video cards show the engine's stage, time left and a live preview.
- Pictures can be made Quick or Detailed with one plain setting, and the chat can ask for the detailed one when the person wants the best quality.

### Apps
- Weather says why it has nothing to show, place search reads on one line, and every app is on one searchable page.
- The Weather app no longer shows "Check your connection" when the real problem is that no place is chosen. It says "Choose a place" with **Add a place** and **Use my location** (and, in Safari, the exact steps to allow location), says when the weather source cannot be reached or is slow, and offers **Try again**. A saved place now answers when the default is Current location and the browser shares nothing.
- **Add a place** results are one line each (town, then the state or region in grey), in a wider list with a clear highlight, a Searching state and "No places match". The Weather default place row stacks so nothing runs behind the list.
- **All apps** (the grid button on the left rail) is now a full page with a search box, Favorites first, apps grouped by topic, and a star on each app. Weather 0.3.1.

### Pictures
- Two kinds of picture, in plain words. **Quick** (a few seconds) stays the default; **Detailed** (15 to 30 seconds, finer detail, many more styles) is the choice for people who want it. Chat uses Detailed when you ask for the best quality, photoreal or a custom look and says so; a style made for Detailed uses it on its own; a **Make it Detailed** or **Make it Quick** button on each picture makes it again the other way. Settings, Pictures and videos has a **Picture quality** row, a **What is the difference?** comparison and **Get Detailed pictures** when it is not installed. Model names appear only under **Details**.


### Audio
- One thing plays at a time. A spoken reply pauses a podcast or video, and starting one pauses MaiPai's voice.
- Spoken reply speed is a setting (Settings, Voice), along with podcast, audiobook and video speed for the media apps.
- One sleep timer (15, 30, 45 or 60 minutes, or the end of the chapter or episode) fades out and pauses whatever plays, MaiPai's voice included. The media apps place its menu.

## [0.2.13] - 2026-10-17

Chat answers while the faster engine downloads, and Home can pause chat and show what is installing.

### Fixes
- Chat said "The AI is still downloading" to every message while the faster chat engine's model downloaded in the background. Chat now works whenever the engine has a model ready, whatever else is downloading.
- A child, teen or guest could save a "yes" for the household likeness switches. Only an adult for themselves, or an owner or admin turning it off, can change them now.
- Finished pictures are checked once more before they show. A picture that fails the check is withheld and the person is told.

### Chat
- The composer shows why chat is paused: restarting, low memory, a model not installed, or an admin pause. An admin can pause chat for the household with a message, and the Status page counts the pauses.
- While Home restarts or updates, the first message waits and a reply that was cut off is asked again once.

### Install and storage
- A bottom strip shows what is installing. Admins open it to see each download.
- Settings, Models and storage lists every component with its size, installs and removes them, and shows whether each fits on the disk.
- The install plan shows the home part and the AI part of the disk space separately.

### Pictures and videos
- Picture and video jobs show their stage, steps and time left, and pictures show a live preview.
- Share sends a video file through the phone's share sheet, and Download saves it named from the prompt.

### Voice
- The microphone is opened once and shared for ten seconds, with a Safari tip when permission is blocked.

### Install
- The installer and the setup wizard size the disk from one table (`shared/diskPlan.json`, from the AI engine's pins and measured install sizes) instead of "3 GB". A fresh install checks the whole plan (`--plan`, default Recommended, capped by the computer's memory), each disk that holds Home, its data folder or the AI on its own, with 20 percent more and the room an install uses while it runs. Too little room stops before any change with the figures and `--plan moderate` or `--plan minimal`; low headroom warns.
- The wizard's plan screen lists every install with its size (Make videos, Make pictures, Chatterbox voice, the chat AI and the rest), the total, the free space and a green, amber or red check. Turning an extra off lowers the total and the files it would download. The storage step and the checks screen use the same numbers.

### Added
- `scripts/gallery.sh`: one local page with every screenshot and design mockup in the repo, grouped by folder, with a filter box, a size switch and a full-size view. It reads the latest `origin/main` (or `--worktree`), serves on `127.0.0.1` only, and `--stop` stops it.

## [0.2.12] - 2026-10-17

Chat moves to a faster engine, and the picture card looks better while a picture is made.

### Chat engine
- On a Mac with Apple silicon and 64 GB or more, chat now runs on oMLX, about a quarter faster than before. After this update the AI engine downloads the faster model (about 19 GB) and builds its environment in the background. Chat keeps working on the old engine until the new one is ready, then switches in a few seconds.
- If the new engine fails to start twice, chat goes back to the old engine and a warning appears in Repairs. To go back by hand, set the chat engine to llama-server in the engine settings.
- The install plan and the disk plan show the extra space before anything downloads.
- Settings lists every component the engine can install, with sizes and whether it fits on the disk.

### Pictures
- While a picture is made, the chat shows a card with the prompt, a progress bar and a stop button.
- Signed likeness proofs let an adult use a household photo for a picture, only with the person's consent.
### Settings
- New **Models and storage** section on Settings, Home settings, Engines and AI: every part of the AI (chat models, voices, pictures, video, picture tools, styles) with its size and last use, **Install** and **Uninstall** with a plain confirmation, and the room left on this computer. Z-Image-Turbo (a 33 GB picture model for the largest computers) can be installed here at any time. Chat can never be left with no model.

## [0.2.11] - 2026-10-17

The microphone works again, and apps show in the left column.

### Voice
- Conversation could say "could not start the microphone" in Safari and Chrome. The page's security rules blocked the code that listens to the mic. That code is now a real file, `/mic-worklet.js`. A new `/mic-test` page and a Copy details button help when the mic still fails.

### Apps
- Package apps appear in the left column. Weather is pinned there by default, and All apps lists the rest.

### Pictures and videos
- The safety line is clearer. Adults get adult content. Anything sexual that involves a child or a minor-looking person is always refused, and plain words like girl, boy or bikini alone are not a reason to refuse.
- Chat control tokens that leaked into replies are removed.
- If you ask for a picture or video, Home waits for the tool and does not claim a picture it never made. An empty reply is asked again once.
- A wide or tall picture in the chat gallery keeps its shape.

Apps now appear in the left column. Weather is pinned there for everyone who can open it, other apps sit under an All apps button at the bottom of the column, and each person can pin or unpin any of them (up to six show). The open app is highlighted.

## [0.2.10] - 2026-10-17

Home copes with low memory and restarts of the AI engine.

### Chat and engine
- A chat request that meets a restarting engine waits for it to come back and asks again once, instead of failing.
- Warm-up no longer loops: Home checks the engine with a read and starts it once per need.
- A picture or video the engine stopped because memory was low shows "Paused: low memory" on its card.
- The engine watches memory, can free leftover helper processes, and answers "restarting, try again" while it shuts down.

### Voice
- Admins can preview any voice, and other people preview the voices installed on this computer.

### Accounts
- Settings has the consent keys for likenesses in pictures and videos (spec-v0.1.156).

## [0.2.9] - 2026-10-17

Picture and video chat is safer and more honest.

### Pictures and videos
- A request that pairs plain no-clothes wording with a child or minor-looking term is refused, for pictures and for videos.
- "Another one" and "one more" make a new picture instead of answering in words.
- Earlier picture and video turns are remembered as made by the tool, so the model stops claiming a picture it never made.
- If a picture or video has started but the reply fails, Home says it is coming instead of "Something went wrong".
- Asking the picture tool to change an existing picture points you to the Edit button.
- A picture you made shows large in chat, and a style file over 120 MB is refused with the reason before it uploads.
- When Home cannot reach the AI engine it says so, instead of saying no model is installed.

## [0.2.8] - 2026-10-17

Chat can make pictures and short videos, and the picture editor can edit with a comment.

### Pictures and videos
- Ask for a picture in chat and Home makes it with the AI engine. The picture shows as a card in the chat, and a job keeps going if you leave the page.
- Ask for a short video, or ask to animate a picture. Videos are offered on the largest Mac setting only, because a clip needs a lot of memory.
- Settings has a Pictures and videos page. Pictures and videos are for adults on their own written chat. Children and teens cannot make them yet, and no setting turns them on.
- The picture editor has a Comment tool.

### Under the hood
- The database moves to version 62 (picture jobs and video jobs). The installer saves a copy of your data first, so a rollback restores it.
- The installer builds the Stack from a newer pin with FLUX.2 Klein picture generation, masked edits, LoRA styles and the video service.

## [0.2.7] - 2026-10-17

The AI engine gains picture tools and video, and an upgrade now fetches the picture reader it needs.

### Under the hood
- The installer builds the Stack from a newer pin. It brings picture tools (remove background, erase, upscale, resize), video generation in the engine, and a fix that pulls the picture reader (projector) an installed model needs, with a Repairs item if that fails.
- Tests can no longer stop or start the installed Stack. A test run used to boot the real engine service out of launchd.

## [0.2.6] - 2026-10-17

Weather is an app, pictures reach the AI, the voice is Chatterbox, and sign-in uses one box per digit.

### Apps
- Packages can now be apps. An app opens at `/apps/<package id>`, shows in search and favorites, and draws its pages from data, with no rebuild. A package app can declare a settings area, which opens from a Settings gear in the app's toolbar.
- Weather is the first app: a big animated weather card, a place picker (Current location, your home, your saved places), an hourly strip, and a temperature unit setting (Fahrenheit or Celsius) that also applies to chat answers. Removing a saved place now deletes it.
- The Today row on the Home page shows a compact weather card.

### Chat
- Pictures you send are shrunk to 2000 pixels on the long side before the model looks at them, and iPhone HEIC photos work.
- A lookup that finds nothing never ends in an empty reply: Home tries once more, then says what is missing and what to do.
- A picture request with nothing to show is dropped instead of answered with an empty gallery.
- Teen and child replies get longer deadlines and keep room for the reasoning a thinking model writes anyway.

### Sign-in
- Each digit of a PIN has its own box. A wrong code shakes the boxes red and clears them, and the lockout countdown turns the boxes off. The lock screen has a password option.

### Voice
- Voice capture works in Safari and Firefox, and each capture failure says what is wrong instead of a vague "blocked".
- Voice settings are one **Voice for you** list with a **Test** button, and every preset voice is listed.

### Search
- Settings, Home settings, Search has a Web search block: your SearXNG address with Test and Save, the source switches, and the teen and child DuckDuckGo choice (owner and admin only).
- Home asks the AI engine for DuckDuckGo search. The engine builds and supervises that small service itself, and Home says "still being set up" while it does.

### Chat start
- Send waits and reads "Getting ready, one moment" while the AI warms up.

### Chat and memory (more)
- The thinking words change more slowly, and the conversation button shows once speech in and out are installed.
- A memory merge keeps both facts when they say different things, and a correction keeps the person's own words.
- "My dog's name is Rover" no longer makes Home ask who Rover is, and a queued question waits for its own chat.
- An edited first message gives the chat a new title from the messages that remain.
- The picture editor has its routes: edit through the AI engine with progress and cancel, preview, then apply as a new version.

### Voice (engine)
- The Studio voice is Chatterbox Turbo, and the engine keeps chat, search and the quick answer model warm.

### Fixes
- The database version now counts the 6-digit passcode change from 0.2.5 (version 60), so a rollback cannot open data the older build cannot read.
- Test fixes: a test left a broken browser storage behind that failed about a hundred other tests, thinking-word timing tests no longer race a random delay, and three lint errors are gone.

### Under the hood
- The installer builds the Stack from the pin `STACK_TAG`, now at the commit with the projector fix for Muse pictures and the ddgs search service.

## [0.2.5] - 2026-10-17

Sign-in works for 6-digit passcodes.

### Sign-in
- A 6-digit passcode no longer fires a wrong 4-digit attempt, so it no longer burns a failed try or locks the account.
- The sign-in screen learns each account's passcode length and signs in at that length.

### Chat
- The empty chat rotates ten chat-only pictures, shuffled in each browser, never the same one twice in a row.

### Fixes
- The ChatPage test for a model that never reasons now matches the screen (INSTANT-01).

## [0.2.4] - 2026-10-17

Setup is clearer, Home searches the web more safely, the voice sounds better, and chat feels calmer.

### Setup
- Home installs Deno 2.9.7 itself (checksum-verified), so the built-in data packages work without installing it by hand. The installer opens the setup address in your browser when it finishes.
- Web search setup has one Test result in plain words, and Continue turns on only after a passed Test. There are no Save or Skip buttons.
- The Tune this computer step is redone, the plan names voice, and the Checks screen no longer moves on by itself.
- Setup errors show as a clear red alert. Passcode boxes turn green when they match and red when they do not.
- Setup installs the chat engine before it pulls models. A new art set covers search and warming up.

### Search
- A grown-up can let teens, or teens and children, use DuckDuckGo-style search beside SearXNG. It is off by default.
- If you skip the web search step, DuckDuckGo stays on for adults.

### Voice
- The new default voice is Chatterbox Turbo, picked by ear. It can add small cues such as a laugh, only the ones it really supports.
- Voice settings are one plain list with a preview and a one-tap choose.
- Conversation mode checks your microphone first and shows help for your browser. A mic problem no longer reopens the overlay in a loop.

### Chat
- Reasoning stays folded by default, with calm rotating words while the model thinks and "Thought for Ns" when it is done. Your choice is remembered.
- A model that always thinks shows a short Thinking badge instead of a mode picker.
- Chat titles come from the first message right away, then a model title replaces it.
- The chat menu matches the history menu: Rename, Pin, Archive, Delete. The plus menu opens above the plus. You can drop files anywhere on the chat page.
- The message box takes focus when you open Chat.
- Muse Glimmer models can take pictures on bigger computers.

### Home page
- A new Home page has an ask box, starter ideas, Today cards from your packages, and Getting started.
- Home asks for your city once, with Use my location or a typed city, so weather works.

### Fixes
- An empty dark box under the chat is gone.
- Weather with no place set gives a plain answer instead of an error.

## [0.2.3] - 2026-10-17

The installer now works on a Mac that has Bun but no Node, and Home starts without Deno.

### Fixed
- Installer: Bun is put on the path as `node` while dependencies install, so packages with install scripts (ssh2) build on a Mac without Node. The background service units carry the same path.
- Home no longer crash-loops when Deno is missing. The smoke checks that need Deno are skipped and the Deno-backed packages stay off until Deno is installed.

## [0.2.2] - 2026-10-17

Computers with more than 24 GB of memory get a stronger chat model, and a fresh install starts with every built-in package on.

### Added
- Muse Glimmer 30B is the chat model on any computer with more than 24 GB of memory. The installer measures memory and picks it by itself: 32 GB gets the 17 GB build, 64 GB and more get the 20 GB build. Computers with 16 or 24 GB keep Qwen3 8B. Muse thinks before every answer, so its first words can take a little longer. Speed on real machines is not measured yet.

### Fixed
- A fresh install no longer starts with 12 built-in packages switched off (music, news, sports, the almanac set and the lookups). The installer now fetches their pinned Deno dependencies once, and Home reads them from its own cache folder. (#217)
- Tests: files in one test run no longer leak state into each other, and each test gets 20 seconds under full-gate load instead of 5. The three flaky-test ledger entries are gone. (#216)

## [0.2.1] - 2026-10-16

A fresh install of 0.2.0 stopped at the dependency step. This release fixes that.

### Fixed
- Installer: Commons packages that point at a sibling package (Core needs Spec) now get that sibling linked in the staged folder, so `bun install` finishes on a clean machine.
- Gate script: `scripts/check.sh` runs when started by hand with no Commons path set, instead of stopping with an unbound variable.
- Tests: the port-ownership test finds the shared worktree script from the main checkout as well as from a worktree.

## [0.2.0] - 2026-10-16

Weather answers get a card and a place of their own, and the setup wizard can tune a Mac that runs the AI.

### Added
- Weather: asking about the weather now shows a weather card built from a single forecast lookup, instead of a paragraph of numbers.
- Weather place: the answer uses your current location when your browser shares it, otherwise a saved place, otherwise the household home. The card says which place it used by label, never by street address, and the model cannot change the coordinates it was given.
- Settings: the household home has a location field with a place lookup, so weather and other local answers know where home is.
- Setup wizard: an optional "This computer" step for a Mac that runs the AI. It applies the recommended power, GPU memory and indexing changes only with your consent, one at a time, and each change can be reverted. A checklist covers the advice that cannot be applied for you.
- Install guide page on the docs site, and `scripts/publish-docs.sh` to build the site and publish it with a dead-link check.

### Changed
- Installer: it checks the downloaded Commons archives against pinned digests and stages Home's own Commons pins before `bun install`, so a fresh install no longer fails on a missing pin.
- Removed setting alias: `household.home_place` is gone. Use the location field on `household.home`. Anything that still writes the old key must switch to the new one.
- The main-branch gate now survives the reduced PATH that launchd gives it, and names the line that crashed when a run fails.
- README: the install section is back and matches the current install line.

### Fixed
- Docs drift map: the install guide page is covered, so the docs check no longer fails on it.

## [0.1.0] - 2026-10-16

First release.

### Added
- Install: `scripts/install.sh` brings up Home and prints its address, then the setup wizard installs the AI engine (the Stack) when you choose that this computer runs the AI. Upgrades keep a snapshot of your data and `--rollback` returns to the last version. `uninstall.sh` keeps your data unless you type `DELETE MY DATA`. Home and Stack ports can be set with `MAIPAI_PORT` and `MAIPAI_STACK_PORT`.
- Setup wizard: a silent engine on the plan screen offers Check again, install errors say what to do next, and a failed retry shows an alert.
- Host tuning for an always-on Mac: `scripts/studio/host-tune.sh` checks and applies power, GPU memory, update and indexing settings, one at a time with your say-so.
- Pictures under an answer: for an adult, Commons structured data ("depicts") now brings in
  more pictures of the subject and puts them first, behind the same checks as every other
  picture. Photos with children in them, and photos filed under another person's own
  Commons category, are left out of a person's row.
### Changed
- Pictures when you ask: the assistant now shows pictures more often when an adult asks who or what something is. The check-again step (after the answer is on screen, add pictures when the question was about a famous person, place or thing) is built and off until it is switched on. Adults on written chat only.

### Fixed
- Pictures under an answer: a screenshot, signature or diagram saved as a PNG,
  a file whose name was mangled by a bulk rename, and a photo of something
  else that is only tagged with the subject no longer show up as pictures of it.

### Added
- Search assist bench: a search the assist makes on the model's behalf now counts
  as a search when the bench scores a run, and a small report compares recency
  recall with and without it. Measurement only; the assist stays off.
- The composer and streaming: replies now stream into the chat as they are
  generated instead of arriving all at once, and an interrupted stream resumes
  where it left off instead of losing what it already said.
- "How do you know" on a reply: a fact the model already knew is marked on
  the outcome, and a person can open the reply and see that source.
- Thumbs up and thumbs down on a reply, with the feedback kept per person.
- The details pane on a conversation, the turn artifact behind a reply, and
  advanced reply stats on the person.
- Attachments: a person can attach an image or a document to a message; local
  storage, extraction, and the document outcome path, with child attachment
  projection.
- Conversation search and pinning, and research mode on a conversation.
- The GPU validation bench, a developer-facing check that sizes the engine's
  validation fill in tokens.
- Pictures in a reply: typed picture results from a search appear inline,
  and a follow-up prompt lets a person ask about a picture directly.
- Grounded replies: a composed lookup reply now cites the search rows that
  produced it, so a person can see where each claim came from.
- A link answer: when a lookup returns a page to open, the reply carries
  the link directly and an article card beside it.
- Page reading: when a person asks about a specific page, MaiPai reads it
  and grounds the answer in that page, showing an article card with the
  source.
- A model picker beside the Chat title: a parent sees the available models,
  the one in use, and one repair action if a model is unreachable.
- Temporary chat: a per-conversation mode that keeps messages out of history
  and memory for the duration of that session.
- Continue: a control under a cut-off reply that picks up where the answer
  stopped, without altering the original.

### Changed
- Pictures in answers: a picture of a film, product or website must name it in its title or description, off-topic Commons pictures (wall details, parody signs, courtyards, factory workers, a person holding a product) are skipped, and the gallery no longer pads with weak pictures to reach five. MaiPai also offers pictures more often when asked who or what something is.
- The OpenAPI document was regenerated to cover the routes added since the
  last release, including the commands and privacy routes.
- The default package set gained the missing package README, changelog, and
  quality scale files for buddy, default, pal, recall, remember, and tutor.
- The voice, STT, and TTS routes are now documented in the OpenAPI file.
- Helper tests for shape and throttle validation were added to the backend
  test suite.

### Removed
- The old turn engine (`turnEngine.ts`) and everything that only it used are
  deleted (docs/design/RULES.md rule 12): every turn runs on the one path.
  The household setting `turn.pipeline.next` ("Use the new reply engine") is
  retired with it; nothing reads it, and a stored value for it is ignored. The
  old engine's reply guards that no live path calls, the pronoun-mismatch
  guard among them (retired by ruling: the model is given the pronouns), and
  the answer-from-this-conversation retry nothing could reach are gone too.

### Security
- A 2026-09-06 code review found `POST /api/llm/chat` and `POST /api/llm/embed`
  gave any signed-in person, including a child, raw model access with none
  of the turn engine's child-safety layer applied. Both routes now require
  owner or admin (`requireRole` instead of `requireAuth`) and are documented
  as owner/admin diagnostics only, not a household chat surface - `POST
  /api/turn` is that surface. This narrows who can call an existing route;
  no caller in this codebase used either route directly, and no release has
  shipped yet, but noting it here per the org's API-compatibility rule since
  it is a real behavior change for anyone who was.

### Added
- Backups (platform plan 2.5, split), the tenth slice of hub core:
  `backend/src/lib/backup.ts`'s `runBackup()` takes a real, consistent
  snapshot of the live database via SQLite's own `VACUUM INTO`, encrypts
  it AES-256-GCM with a dedicated key from the existing keystore, and
  writes it to the `local` target (a new sibling directory of `data/`,
  `MAIPAI_BACKUP_DIR` overridable). `pruneBackups()` is a real
  grandfather-father-son retention scheme (seven daily, four weekly,
  three monthly, bounded by real non-overlapping time windows, not just
  bucket counts) wired as a genuine daily scheduled job
  (`backup.run`) from the start. `restoreBackup()` decrypts an archive
  back into a valid, queryable SQLite file, proven by tests that actually
  open the restored database and read real rows back, including a
  deliberate bit-flip test confirming a tampered archive is refused
  (GCM's own auth tag) rather than silently restoring garbage; it's real
  and tested but deliberately not wired to any HTTP route, since safely
  swapping a running process's live database needs staged update/rollback
  machinery (2.4) that doesn't exist (no release has ever been cut). New
  routes, owner/admin only: `GET /api/backups`, `POST /api/backups/run`.
  A bug in the retention window logic (a same-day duplicate backup could
  spill into the weekly tier instead of being pruned) was caught by
  writing the test for it, not by a review, and fixed with strict
  non-overlapping windows instead of a cross-tier fallback. **Not built:**
  a multi-store declaration registry (only one store exists to declare),
  `hub`/`smb` targets, a per-target size cap, the emergency kit and
  Storage page (chapter 6), and the restore drill (no release cut yet).
  Full reasoning in `docs/dev.md`.
- Conversation history (platform plan 4.14, split), the ninth slice of hub
  core: `backend/src/lib/conversationHistory.ts`'s `logTurn()` writes a
  real row (new `conversation_turns` table, schema version 5) for every
  completed turn from `turnEngine.runTurn()`, refusals included. Visibility
  reuses the exact rule `memory.ts` and `settings.ts` already share
  (`lib/access.ts`'s `canAccessPerson`: self, or owner/admin only for a
  child, nothing of a teen's or an adult's, the same documented narrowing
  `memory.ts`'s scope:person visibility already made since there's no
  summarization mechanism yet to safely honor 4.14's "a summary and safety
  flags for a teen's"). `household.conversation_retention_days` (default
  90, `backend/src/settings/coreKeys.ts`) is the first core settings key
  besides locale to actually get read by anything; `runRetention()` hard-
  deletes turns past the window (no summarize-then-purge yet, no LLM to do
  it), except a safety-flagged turn from a minor speaker, which is never
  deleted before 90 days regardless of how short the household sets
  retention. Wired as a real daily scheduled job from the start
  (`conversation.retention`), not a manual trigger, since the scheduler
  (4.7) already existed. New routes: `GET /api/conversations` (own, or
  `?person=<id>` for owner/admin), `GET /api/conversations/export` (a real
  403 on denial, unlike list's empty-result browsing precedent). **Not
  built:** search across content types, summarization, an audit log, and a
  synced spec-shaped record for robot parity. Full reasoning in
  `docs/dev.md`.
- The turn engine (platform plan 4.5, split), the eighth slice of hub core:
  `backend/src/lib/turnEngine.ts`'s `runTurn()` is the real pipeline behind
  a conversation turn on the `chat` surface (the only surface implemented;
  overlay/pod/robot/tv/phone are a named gap, same shape as 4.11's role
  list). Safety runs first (a `refuse` verdict returns a deterministic
  refusal with no skill routing and no model call; `allow_with_resources`
  proceeds normally with crisis resources riding alongside the reply,
  never replacing it). Then the deterministic skill floor: a bundled
  package's `routing.patterns` (a single `*` wildcard capturing an
  argument) or `routing.examples` (keyword-overlap, the same
  documented-placeholder move `lib/memory.ts`'s recall() already made for
  real embeddings) can fire a Tier 0 skill with no model involved at all;
  a `consequential` package only fires on a real pattern match, never a
  fuzzy one. When nothing clears the floor, a stable-first prompt (persona
  and rules, content policy, standing instructions, the bundled skills
  list, then the volatile zone: recalled memories, then the current time)
  goes to the real `chat` role, with a hard character budget
  (`PROMPT_SYSTEM_CHAR_BUDGET`) proven by a test with 50 long memories.
  New route: `POST /api/turn`. `lib/text.ts` extracts the shared
  tokenizer memory.ts's recall() and the turn engine's example matching
  both need, one definition instead of two. **Deliberately not built:**
  tier 2 native tool calling, remote candidates, `ask`-continuation (the
  spec's `SkillResult.ask` exists but no recipe step type can ever produce
  one, a real interpreter-level gap, not a skipped feature), a real
  Persona/style record (a fixed default stands in), and conversation
  history/summary/cross-surface context (platform plan 4.14, not built:
  every turn is stateless beyond a fresh memory recall). Full reasoning in
  `docs/dev.md`.
- The `chat` model role and a llama-server router skeleton (platform plan
  4.11, split), the seventh slice of hub core: `spec/llm/` has a
  hand-written, language-portable wire contract for llama-server's
  OpenAI-compatible chat-completions surface (non-streaming; no tools,
  JSON schema, or grammar yet), a real `LlamaServerClient`, and an
  in-process stub server for dev and test that speaks the identical
  contract, so the router path (start a backend, health-check it, send a
  request, parse a response) is exercised for real end to end without a
  GGUF. `backend/src/lib/llmSupervisor.ts` picks the backend lazily on
  first use: `MAIPAI_LLAMA_SERVER_URL` to point at an already-running
  server, `MAIPAI_LLAMA_SERVER_BIN` + `MAIPAI_CHAT_MODEL_PATH` to spawn a
  real one, or the stub when neither is set, which is every dev machine
  and the test suite today. `backend/src/lib/llm.ts` is the role port:
  only `chat` is implemented, every other role (`router`, `embed`,
  `vision`, `image`, `video`, `coding`, `tts`, `stt`, `wakeword`) is a
  real, named `capability_missing`/`unsupported_role`, not a silent gap.
  New route: `POST /api/llm/chat`, the same "provisional real caller
  ahead of the turn engine" pattern `/api/safety/check` set for the
  safety layer. `host.llm.complete` in `packageHost.ts` deliberately stays
  `capability_missing`: the `Host` RPC boundary is synchronous and a real
  chat completion is inherently async network I/O, a real architectural
  gap (needs both recipe interpreters to support async host calls) kept
  distinct from "not built yet." No GGUF, engine binary, residency policy,
  or `ModelCapabilities` record exist yet; which default chat model to pin
  and what hardware to build the real (non-stub) path against are flagged
  as Jesse's call, not guessed. A same-day review found and fixed a real
  bug: a failed backend start left a rejected promise cached forever,
  permanently wedging the `chat` role after one transient failure until
  the process restarted; also flagged, and deferred rather than guessed
  at, a missing rate limit on `POST /api/llm/chat`. Full reasoning in
  `spec/llm/README.md`.
- The scheduler (platform plan 4.7), the sixth slice of hub core: a
  durable job store (`backend/src/lib/scheduler.ts`, `scheduled_jobs`
  table) with one-shot and recurring jobs, persisted and surviving
  restarts, polled every 60s by `backend/src/index.ts`. Backs
  `host.schedule` for real (previously `capability_missing`) and finally
  gives `lib/memory.ts`'s maintenance pass a real timer instead of a
  manual-only trigger: a `memory.maintenance` core job seeds itself
  idempotently at every boot. New routes: `GET /api/scheduler/jobs`,
  `POST /api/scheduler/jobs/:id/cancel`, `POST /api/scheduler/run-due`.
  Scope is deliberately narrower than 4.7's full description: no device
  target, no quiet-hours policy, no notification-system integration (all
  need infrastructure that doesn't exist yet), and recurrence is a
  minimal `every:<n><unit>` grammar, not RRULE. A same-day review found
  and fixed three real issues: a past one-shot time was silently
  accepted as immediately due despite the code's own docstring and error
  message claiming rejection; a recurring job's reschedule advanced from
  the moment it actually fired rather than from its own due time, which
  would have permanently drifted a daily job's time-of-day later on
  every late tick (the fix needed a second pass once tested against a
  very overdue job, landing on a direct "next aligned slot" calculation
  rather than catching up one interval at a time); and cancelling a job
  that had already run could silently flip its status after the fact.
  Full detail, including the one known gap (a job scheduled from inside
  a recipe can't carry that recipe's input scope through yet), in
  `docs/dev.md`.
- The package host (platform plan 4.9), Tier 0 only, the fifth slice of
  hub core: `backend/src/lib/packageHost.ts` builds a real `host.*`
  implementation per package invocation, backing `memory.recall`/
  `memory.remember`/`data.forget` and `config.get` against the real
  memory and settings stores, permission-checked against the manifest's
  declared `permissions` first. Everything without a real backing
  service yet (fetch, home control, integrations, speech, the LLM role,
  camera, OCR, scheduling, files, actions, diagnostics) honestly throws
  `capability_missing` rather than silently no-opping.
  `backend/src/lib/skills.ts` loads a bundled package's manifest and
  recipe from `backend/packages/<id>/`, validates both against spec's
  schemas, checks `min_role`, validates the call's inputs against the
  manifest's own `args` JSON Schema with `ajv`, and runs it through
  spec's real interpreter. `backend/packages/remember/` is the first
  bundled package, the plan's own named example. New routes:
  `GET /api/skills`, `POST /api/skills/:id/run`. `spec/emulators/ts/
  host-emulator.ts` gained an exported `Host` interface so the
  interpreter types against a contract instead of the concrete emulator
  class, which also surfaced and fixed a real bug: the generated
  `Recipe` step type was silently `any`, defeating the interpreter's
  exhaustiveness check. A same-day review found and fixed four real
  issues (a missing required input silently writing a literal
  `{placeholder}` to memory, a raw `TypeError` escaping `host.fetch` on
  a malformed url, duplicated redaction logic that had already drifted
  between the real host and the emulator, and a documented mismatch in
  `capability_missing`'s catalogue wording). Full detail, including what
  Tier 1 and every other deferred `host.*` method still need, in
  `docs/dev.md`.

### Fixed
- A manifest that fails validation (a bundled package edited to a shape
  the running hub's schema doesn't know yet) is now diagnosable: it's
  logged once in the hub log and refused with "I can't do that right
  now. Something on my end isn't working," instead of silently landing
  the ungrounded-knowledge line a household member would read as "the
  conversation doesn't have that," with no trace of what actually went
  wrong (fixes #166).
- A `code-review` pass (2026-09-04) across the identity, safety, and
  memory slices found and fixed real bugs, the most severe being a
  safety-invariant violation: `self_harm` co-occurring with another
  flagged category (e.g. a jailbreak framing wrapped around a genuine
  self-harm statement) silently withheld crisis resources instead of
  offering them. Also fixed: `csam` and `credible_threat` false-positives
  on ordinary text ("MCP", "Essex", gaming talk); a soft-deleted person's
  session and credentials still working; `X-Forwarded-Host`/`-Proto`
  trusted unconditionally (CSRF and cookie-security gaps matching a fix
  already applied to `X-Forwarded-For`); an owner/admin able to export or
  erase an adult's private memories despite being unable to browse them; a
  lost-update race in the sign-in lockout counter; a macOS Keychain
  failure mode that could silently corrupt every stored PIN/password. A
  second review pass on the fix diff itself, before committing, caught
  two regressions the first pass introduced (an over-broad CSAM
  false-positive fix, a dropped obfuscation-resistance check) plus four
   smaller gaps; all fixed in the same commit. Full list with fix-site
  details in `docs/dev.md`'s "Code review pass, 2026-09-04" section.
- The chat header, message actions, and reply stats visibility were
  corrected so they render and toggle as intended.
- A searched question is now answered in the shape it calls for: prose
  for an ordinary question, a numbered list only when the results
  themselves were asked for. The #156 fix's own list-format line fired
  on every searched reply with rows, so a plain yes-or-no question came
  back as a numbered list too (#168).
- A direct-topic search (the kind SearXNG answers with a knowledge-panel
  infobox instead of ordinary results) now reaches the model at all: the
  search rows the model reads used to skip infoboxes entirely, so the
  model saw only whatever generic results came alongside one, usually
  with no summary text. When a whole result set genuinely has no summary
  text, the reply now says so instead of rephrasing the titles as if
  they were an answer (#169).
- Correcting a fact MaiPai just stated now gets a real answer, not an
  empty promise: it searches again or concedes plainly instead of
  saying "I'll look that up" or "I'll update my information" and doing
  nothing (CORRECTION-02).

### Added
- Settings (platform plan 4.6), the fourth slice of hub core: the store,
  built on the `SettingValue`/`SettingsKey` shapes spec v0.1 already
  defined. `spec/settings/keys.json` is generated, not hand-edited, from
  `backend/src/settings/coreKeys.ts` via a new `bun run gen:settings`
  script wired into `check.sh`'s drift check; one real key so far,
  `household.locale`. Values are keyed by scope (`household`,
  `person:<id>`, `device:<id>`) with a real hybrid logical clock
  (`lib/hlc.ts`) generated and compared on every write for genuine
  per-field last-writer-wins, even before real sync exists. Household
  settings: read by anyone, written by owner/admin. Person settings: self,
  or owner/admin for a child (the same rule memory uses, now shared via a
  new `lib/access.ts` rather than a second copy). Chosen over the turn
  engine as the next slice since the turn engine fundamentally needs an
  LLM and packages that don't exist yet; full reasoning in `docs/dev.md`.
  A same-day review before committing found and fixed a real gap: a
  `secret: true` registry key had no redaction anywhere in the response
  path, untested only because today's one declared key isn't secret; also
  fixed an HLC-recovery gap (a wall-clock regression after a restart
  could permanently block writes to a key) and an inefficient full-table
  role lookup. Details in `docs/dev.md`.
- Memory (platform plan 4.4), the third slice of hub core: the store
  (`backend/src/lib/memory.ts`), built directly on the `MemoryRecord`
  shape spec v0.1 already defined, no spec changes needed. `remember`
  validates against the generated Zod schema before writing; `list`
  browses without touching usage; `recall` scores by entity-first-then-
  keyword-overlap (a documented deterministic stand-in for real
  embedding-based "scored vectors", which need the embed role, 4.11) and
  does touch usage; `supersede` and `archive` are the routine tombstoning
  lifecycle (a real status transition, never a row delete); `forget` and
  `exportPerson` are the per-person privacy pair (2.2), and `forget` is
  the one real DELETE in the file, a deliberate exception to "never
  hard-deletes" for the deliberate erasure right. `runMaintenance`'s decay
  scoring is adapted from the legacy hub's tuned exponential-decay
  formula (principle 8); durable memories are protected from decay, a
  `state`-category memory always expires after 7 days, and unlike the
  legacy source this pass never hard-deletes a tombstone, since platform
  plan 4.4 says the store never does outside `forget()`. Visibility rules:
  household memories to any signed-in person (sensitive ones admin/owner-
  only), a person's own `scope: person` memories, plus a child's (not a
  teen's or an adult's) to owner/admin; `scope: self` is never returned to
  anyone, per the schema's own description. Deferred: the sleep-time judge
  itself, profile paragraphs, and real embedding-based recall (all need an
  LLM and/or embedder that don't exist yet), mood/unfinished-business
  reads (robot-specific), and real scheduled maintenance (4.7).
- The safety layer (platform plan 4.3), the second slice of hub core: a
  deterministic multi-signal classifier for the eight floor categories
  (self-harm, harmful requests, credible threats, CSAM, grooming, PII
  extraction, prompt injection, jailbreak framing), text only. Design and
  code live in `spec/safety/` so a Python port can mirror it later the way
  `spec/interpreters/` does; TS only for now, no `bot` content exists yet
  to pin it. New shared shape `SafetyResult` (dual-codegen'd), a labelled
  corpus (`spec/safety/corpus/corpus.json`, synthetic and persona-roster
  only), and `spec/safety/README.md` as the full design record including
  known limitations. The CSAM detector is adapted from the legacy hub's
  hardened, obfuscation-resistant blocklist (principle 8); the legacy
  hub's model-trusting "text floor" is explicitly not reused, since 4.3
  replaces exactly that architecture with a pre-model refusal. Hub-side:
  `backend/src/lib/safety.ts` applies the per-band policy (self-harm never
  refuses, only offers resources; every other category refuses; a minor
  speaker always sets `notify_parent`), `POST /api/safety/check` is the
  real caller until the turn engine (4.5) exists to call it internally.
- Hub backend skeleton (`backend/`, Bun and Hono, per `STACK.md`): a Bun
  workspace root joins it to `spec/`, so both share one lockfile and the
  backend imports `home/spec/`'s generated Person schema directly.
- Identity and sign-in (platform plan 4.1) and people (4.2), the first
  slice of hub core (chapter 4): profiles with a PIN or password
  (Argon2id via `Bun.password`, HMAC-peppered, the pepper held outside the
  database by a keystore that uses the macOS Keychain, Windows DPAPI, or a
  0600 key file), per-profile lockout with exponential backoff plus a
  per-IP throttle, `HttpOnly`/`SameSite=Strict` session cookies with a CSRF
  origin check, the role ladder (owner, admin, adult, teen, child, guest)
  enforced on every mutating route, and first-run setup that creates the
  household owner. SQLite storage via Drizzle ORM, with the schema-version
  guard `docs/ENGINEERING.md` requires (a database stamped newer than the
  running build refuses to open). Deferred to a later hub release:
  passkeys, TOTP, Quick Connect, device tokens, capability grants and
  content ceilings, the approval queue (all noted in `docs/dev.md`).
- `home/spec/` v0.1: the household's shared record shapes (Person,
  Setting, Memory/Entity/Episode, the package manifest, recipe, and
  result shapes), as JSON Schema with generated Zod and Pydantic v2
  bindings, both proven against fixtures. Both Tier 0 recipe interpreters
  and both host emulators, with recipe conformance fixtures proving the
  TS and Python interpreters agree. UI schema v0 for the Chat page.
- `scripts/check.sh` regenerates and drift-checks the spec codegen, runs
  its tests, then the backend's typecheck and tests, before the pinned
  `@maipai/standards` core.

### Changed
- This repo's history was reset to start fresh on the platform rebuild
  design (`docs/dev.md`); the prior version's history and 21 releases are
  preserved locally, outside GitHub, never migrated.
