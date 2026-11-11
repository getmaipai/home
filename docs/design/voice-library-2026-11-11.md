# The voice library and one Add voice button (design, 2026-11-11)

Owner request (Jesse, 2026-11-11): browse and download voices from the Add voice box; quick filters by gender, language and quality; plain names, not
ids like `jeffrey_enhanced`; country flags; a quick search; a good-looking box; one **+** button that downloads, clones or makes an inspired voice.

Reuse check: searched voice, chatterbox, catalog, voice pack, inspired, clone, VOICE-BROWSER-01 in home docs, backend and frontend; found
[voices-2026-10-18.md](voices-2026-10-18.md) (sources, licences, catalog voice packs, admin-only creation, VOICES-05), [household-voices-2026-10-20.md](household-voices-2026-10-20.md)
(clip voices), VOICE-BROWSER-01 in BACKLOG (filters, preview, Download), `backend/src/lib/voiceCatalog.ts` (an admin-only browser over a community repository, retired by section 5 of the 2026-10-18 note),
`backend/src/lib/clonedVoices.ts`, `frontend/src/apps/settings/VoiceBrowserSection.tsx` and `frontend/src/lib/voice/voiceBrowserRows.ts` (friendly names). This note extends them; it does not replace the licence and consent rules, which stay as written there.

## 1. What changes for the person

Today the voices page has two buttons, Make a voice and Make an Inspired voice, each with its own plain box. They become **one + Add voice button** (owner and admin only, as now)
that opens one box with three tabs:

| Tab | What it does | Built on |
|---|---|---|
| **Download** | Browse a library of ready voices, preview one, press Add. | Catalog voice packs (VOICES-05), new browser below. |
| **Clone** | Make a voice from a 6 to 30 second recording or upload (WAV, MP3, FLAC). | `POST /api/voice/cloned`, unchanged. |
| **Inspired** | Make a voice inspired by a description or a clip, as today. | The Inspired flow, unchanged, moved into the tab. |

The box is a large sheet on a computer and full screen on a phone. Download is the first tab.

## 2. The Download tab

- **Search** at the top, filters as you type, over name, description, country and language ("british calm", "spanish woman").
- **Filter chips** under it: Gender (Woman, Man, Neutral), Language, Country (a flag per option), Quality (Good, Great, Best). Chips combine; the count updates ("23 voices"). A clear button resets.
- **Cards**, three across on a computer, one on a phone. Each card: a round flag, the plain name ("Warm and calm"), a second line "Woman, British English", a tiny quality badge, a one-line description, a **play** button (about 8 seconds of the fixed sample sentence) and **Add** (shows the size, "0.6 MB"). A voice already added shows "Added" and an Open link.
- **Names are written for people.** A voice never shows a file or engine name. Its name is a short descriptor made from what was measured (pitch band, pace, energy), for example "Warm and calm", "Bright and quick", "Deep and measured"; the second line says who it sounds like in plain facts. Two voices never share a name (a country or number is added, "Warm and calm (Irish)").
- **Flags** come from the voice's country (the speaker's accent or region), shown as a round flag with the country name beside it for screen readers. A voice with several or unknown places shows a neutral globe. Flags are drawn by the kit as images, not text emoji, so Windows and the robot show them the same way.
- **Add** installs the voice into the Stack (the clip goes through the Stack's own downloader and is stored by hash; nothing is fetched at speech time). It then appears in the voice list with the rest, and Test and Set as default work as for any voice.
- A child or teen never sees the Add button. Their list is the voices marked for all ages, as in the 2026-10-18 note.

## 3. Where the voices and their facts come from

Only licensed sources already approved in the 2026-10-18 note: the CC0 donation clips, the synthetic Kokoro references, and CC-BY sets with attribution (VCTK, which carries gender and accent per speaker). Excluded as before: anything non-commercial, anything naming a real person, public figures.

Each voice is a catalog entry (a `voice` pack manifest, VOICES-05) with fields the browser filters on, all filled by a **build-time measuring script** on a scratch machine, never at runtime:

| Field | How it is filled |
|---|---|
| `label`, `detail` | From the measured traits (pitch band, pace, energy), with a fixed template; a person reviews every label before publishing. |
| `gender` | Source metadata where it exists (VCTK, Kokoro); otherwise a pitch measure confirmed by ear. Shown as Woman, Man or Neutral. |
| `language`, `country` | Source metadata where it exists; otherwise a language-identification model plus an accent estimate, marked "estimated" in the catalog and checked by ear before publishing. |
| `quality` | A measured score (a speech-quality estimator plus the clean-clip checks: length, noise floor, clipping) mapped to Good, Great, Best; a voice below Good is not published. The listening gate has the last word. |
| `licence`, `attribution`, `source` | As in the 2026-10-18 note; CC-BY attribution shows on the card detail. |
| `sample` | An 8 second preview file, served with the pack index so the browser can play it before the voice is added. |

The pack **index** (one small signed file) carries every voice's fields and its preview address, so search and filters run in the browser with no download. The hub reads the signed index and previews from the public catalog the same way it reads package listings (public, no household data sent; PRIVACY.md). The old community browser (`voiceCatalog.ts`) stays retired.

## 4. Look

A calm sheet in the theme tokens only (no fixed colors): large rounded cards on the surface color, the flag as a round image at the card's top left, the name in the title type, the play button as a round primary control that turns into a small level meter while playing, chips as the kit's pill chips, search as the kit's pill input with a search icon and a clear button. Quality is three small dots, not stars or words. Empty search shows "No voices match. Clear a filter or try another word." with a Clear button. A mock-up is made and judged before any build (preview rule).

## 5. Pieces, in order

1. **Catalog**: `voice` pack manifest fields above, the signed index with previews, the catalog check (licence, attribution, no named person). Repo: catalog.
2. **Measuring script and first set**: 30 to 60 voices measured and listened to; labels reviewed. Repo: home `data-scratch` tooling, output to catalog.
3. **Hub**: read the index, list and filter endpoint, install-a-voice-from-pack (admin only), previews proxied. Repo: home backend.
4. **Kit**: a round flag element (images for countries), a voice card element with the play-to-meter control. Commons first (rule 9), tagged by the session.
5. **The Add voice box**: the three tabs, the Download tab, search and chips, the one + button replacing two. Repo: home frontend.
6. Docs (user: how to add a voice; dev), screenshots at 1440 and 390, dark and light.

## 6. Decisions and open points

- **Flags.** VOICE-BROWSER-01 (2026-09-20) said language and country as a flag-free text pair. This request replaces that ruling: flags are wanted. The text pair stays beside the flag.
- **Language scope of the first release.** The standard voice engine's languages decide what a downloaded voice can speak well; a clip in another language only helps if the engine speaks it. The first set is English across accents (US, UK, Irish, Scottish, Australian, Indian and more), with other languages added when the engine supports them (to confirm against the engine's published list before step 2).
- **Quality** is measured, not user-rated, in this release.
- **Not in this release:** rating or reviewing voices, uploading to the catalog from Home, voices of real named people.
- **First backend release:** VCTK only, with plain names built from its speaker metadata. Measured labels and non-English voices are the next step.
