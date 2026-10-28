# Live radio stations and the full Podcasts app (port review, 2026-10-27)

Owner request 2026-10-27: port the pre-rebuild hub's radio stations and its entire Podcasts app. Per platform principle 8 every
feature below is reviewed and rebuilt, never carried; each row has a one-line verdict. Sources: a read-only audit of the archived
pre-rebuild repo (live radio: `musicRadioLive.ts`, `musicRadio.ts`, `radioRecord.ts`, `LiveRadioMiniBar.tsx`, `liveRadioEngine.ts`;
podcasts: `lib/podcast/*`, `routes/podcast*.ts`, `components/podcast/*`) and what Home ships today (Podcasts package, Music package,
the global mini player of MEDIA-VIZ-01 to 03).

## What Home already has

Podcasts (`backend/packages/podcasts`, `lib/media/podcasts.ts`): subscribe by feed address, hourly shelf poller with conditional GET,
Listen now, Shows, Episodes, Queue, Saved, stream by default, Save to the household file store, keep-latest rules, bookmarks,
OPML in and out, a child never sees explicit episodes, the global mini player with sleep timer. Music has local similarity radio
only: "Radio is made from the home's own music only" (media-apps-overview). There is no internet radio.

## Decision needed once, recorded here: internet radio is an outbound service

Live radio calls a public station directory (radio-browser.info, three mirrors) and each station's own stream host, which sees the
home's address. PRIVACY.md says zero phone-home, so this follows `THIRD-PARTY-SERVICES.md`: behave as the user would, one limiter at
one choke point, foreground only, a privacy row `platform:radio-directory` (hosts listed, adults and teens only, off for children
unless a parent saved the station), no background fan-out, no listen reports. The owner asked for the feature, which is the
opt-in; the privacy page lists what leaves the home.

## Live radio: verdicts

| Pre-rebuild feature | Verdict |
|---|---|
| Browse popular, search by name, country, genre chips | Rebuild in Music as a Radio tab, directory call server-side through the limiter; country uses the directory's exact country code parameter (the old free-text filter was unverified). |
| Add to "Your stations", add by name and address, remove | Rebuild; stations are household or person records. The `media-source` kind enum has no station kind, so spec first: `kind: "station"` in `commons` `spec` (tag), then Home. |
| Preview a result before adding | Rebuild (play by directory id, resolved at play time). |
| Stream proxy (same-origin audio, analyser tap) | Rebuild with the address guard on every hop; adds ICY title parsing so the bar shows the song (the old one never read it). |
| Pause rejoins live edge, mute, volume, duck under companion speech | Port the behaviors on the host-owned element; no second audio engine. |
| Mini player for a live stream | Extend the host: an item with no duration; the bar shows a Live badge, no seek. Station name and ICY title ride the existing `subtitle` update. |
| HLS stations | Deferred: shown as "not supported yet", not silently failing. Later slice with hls.js (pinned dependency). |
| Timed recording to a file | Rebuild later on the Stack `media.fetch` job (the old one kept state in one process and bypassed the address guard). |
| Family gate | Fixed from the old build: the server enforces age band and surface on every radio route; a child plays only stations a parent saved. |
| TV "Live Radio Hour" block, another person's station on TV | Dropped (TV is built last; the old path ignored ownership). |
| Listen reports to the directory, lock-screen "radio" report | Listen reports dropped (phone-home). Media Session metadata stays through the host. |

## Podcasts: verdicts

| Pre-rebuild feature | Size | Verdict |
|---|---|---|
| Directory search, charts, show preview (iTunes; PodcastIndex with a key) | M | Rebuild: iTunes Search and charts through one limiter, PodcastIndex only if the admin adds a key; privacy row `platform:podcast-directory`; Add show form (open item in MEDIA-PODCASTS-01). |
| Subscribe, refresh, auto-keep, auto-download | | Already built; gap is per-show auto-transcribe. |
| Smart filters on the episode list | S | Rebuild as saved filters per person. |
| Per-show speed and skip intro/outro | S | Rebuild and apply in the player (open in MEDIA-PODCASTS-01). |
| Trim silence, voice boost | M | Rebuild in the shell audio graph (shares the MEDIA-VIZ analyser context; one `AudioContext`). |
| Sleep timer (minutes, episode, chapter) | S | Already in the audio session. |
| Chapters, Podcasting 2.0 chapters and persons | S | Rebuild as episode chapters and credits on the play page. |
| Bookmarks | | Already built (`marks`). |
| Snips (short saved clips plus a note) | M | Rebuild on a Note record, after transcripts. |
| Transcripts: publisher transcript first, else Whisper via the Stack | M | Rebuild; Stack job, not the app process. |
| Transcript search | S | Rebuild over stored transcripts only. |
| Summary, takeaways, auto-chapters | M | Rebuild as one Stack LLM job per episode, cached, adult and teen. |
| Ask this episode | M | Rebuild through the chat turn engine with the transcript as context (RULES: engine features are the implementation); no private chat path. |
| Study kit | S | Rebuild as flashcards in Notes after Ask. |
| Ad scan and skip | L | Rebuild after transcripts; skips ranges, never cuts audio; "not an ad" report. The audio-fingerprint detector stays dropped (it was disabled). |
| Generated shows (AI-made podcasts: sources, outline, script, personas, TTS, cover, stingers, schedule) | L | Rebuild in four slices on the shipped chat model and Stack TTS, sources limited to ones Home already has (news, weather, household, bookmarks); sports, Wikipedia, later; a YouTube bridge needs Jesse's approval in the moment (rule V1). |
| Private RSS out for generated shows | M | Rebuild last; tokened address, off by default (inbound exposure). |
| gPodder sync | M | Rebuild with app passwords from the credentials center (CREDENTIALS.md). |
| Stats and year in review | S | Rebuild from `media-progress`; no new table. |
| Offline blobs with refs and GC pins | M | Already covered by Save and KEEP-OFFLINE-01. |
| Runtime table creation outside migrations | | Dropped: every table is a migration, spec records first (no data debt). |

## Supersedes

- media-apps-overview, Music row: "Radio is made from the home's own music only." Superseded for a new, separate Radio tab of outside
  stations; the similarity radio from the person's own library stays as is. Internet radio needs no change to RULES.md.
- media-apps-blend, Podcasts rows: "drop clips and filters" is superseded by PODCAST-PORT-03 and 07; "ad detection: drop" by
  PODCAST-PORT-06; "AI-generated shows: drop here" by PODCAST-PORT-08 to 10 (own design note first). "Directory search, opt-in,
  adults" stays: PODCAST-PORT-12 and RADIO-08 add the household switch and teens stay out until the owner rules.
- MEDIA-PODCASTS-01's Open list (Add show form, per-show speed and skip applied, transcripts) is delivered by PODCAST-PORT-01, 02
  and 04. Credits and the title/creator/visibility detail stay with MEDIA-PODCASTS-DETAIL-01. The open verdicts row for Podcasts in
  the backlog (the pre-rebuild feature verdict list) is delivered by this note.

## Opt-in, minors and gates

Outside radio and podcast directories were off until a household switch turned them on (RADIO-08, PODCAST-PORT-12); the owner made both default to on on 2026-10-28, each with a privacy
row and a budget row in `docs/THIRD-PARTY-SERVICES.md`. A child never reaches a directory; a minor's search text passes the
household-name and PII check before it leaves; a teen gets no adult-tagged stations, and teen access to the podcast directory is
the owner's call (an open question, closed to teens until answered). Generated and summarized output passes the person's band
floor. gPodder sends listening history out, so it is opt-in per person and never for a minor (rule 6a). Private RSS out opens an
inbound address, so it needs its own design note before any build. Kit gaps (a Live badge with no seek, a text input for package
pages) are commons changes first (RADIO-07; rule 9(c)); a tag needs Jesse's yes.

## Slices (build order; each is one worktree, tests first)

First: RADIO-01 (spec), RADIO-07 (kit), RADIO-08 and PODCAST-PORT-12 (switches). Then RADIO-02 to RADIO-04, PODCAST-PORT-01 to 04.
Later: RADIO-05, RADIO-06, PODCAST-PORT-05 to 11, 13, 14. Each row in `docs/BACKLOG.md` carries its reuse check, acceptance and exit.

## Rules these slices must keep

Age and surface gates outrank everything; a failed tool never fails the answer; shipped kit parts only, restyle by tokens
(rule 9); no new status UI (reuse the existing mechanisms); one limiter per outside service; every error says what went wrong and
what to do; privacy rows list every host.
