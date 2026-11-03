# Settings, Pictures, videos and music: audit and redesign (2026-11-02)

Status: proposed, design only. Item VIDEO-SETTINGS-01 (this note). Nothing here is built. Owner words (Jesse, 2026-11-02): "the entire
'Pictures, videos and music' in home settings needs to be revamped - you have things repeating, things and terminology that no longer
apply, you didnt add the lora importer/browser and permissions thing I asked you."

The earlier ask this note makes real: a LoRA browser and installer ported from Loki Doki; only admins add LoRAs through household settings;
a LoRA is admin-only until an admin marks it usable by others; admins mark LoRAs NSFW; NSFW LoRAs and NSFW generated content are locked
items (no title, picture or description) until the person enters their own passcode, and relock on leaving the page; things made with an
NSFW LoRA are auto-marked NSFW and the creator can unmark one after a confirmation and a fresh passcode. Also: the levels are Standard,
Boost and Max (Quick, Detailed and Wan are retired words for adults; children and teens keep a silent Wan Quick as their Standard);
LTX-2.5 is the video family; people never see resource words (admin surfaces may show sizes).

This note changes the Settings area only. The lock, the `Lora` record and the Create picker stay as
[video-loras-2026-11-02.md](video-loras-2026-11-02.md) decided them; where this note sharpens one of its Settings sections, section 1 says so.
Mockup (1440 and 390, light and dark, opened and judged): [assets/settings-media-2026-11-02/](assets/settings-media-2026-11-02/index.html),
captured by [cap.sh](assets/settings-media-2026-11-02/cap.sh). Today's screens: [current/](assets/settings-media-2026-11-02/current/).

## 0. Decisions in one list

| # | Decision |
|---|---|
| S1 | The area keeps its name, **Pictures, videos and music** (`media`, household, admin only), and gets four tabs: **Pictures, Videos, Music, Styles**. The tab **Media library** is deleted: it draws the same screen a second time. |
| S2 | One home per setting. Policy (who can make what, limits) lives in this area. Which model fills a level, its install and its switch live in AI and models and Models and storage. This area shows a "Choose models" link for those, no state of its own, never a second control. |
| S3 | Every picture and video setting says Standard, Boost or Max. Quick, Detailed, Wan and LTX-2.3 leave every adult-facing line. Model names appear on Models and storage rows; a style's base ("LTX-2.5") and size appear on the Styles tab, where an admin chooses and checks a file. |
| S4 | The two "who can make" tables of disabled switches are deleted (a switch nobody can flip is a sentence). Their claim that children and teens cannot make videos is false in the code, and is replaced by true lines (section 2.2). |
| S5 | **Styles** is one tab for pictures and videos: the browser (Hugging Face on, Civitai off until an admin turns it on), install as an admin-initiated job, import from a file, a list with availability (Only admins, All adults, Chosen people), the Adults only flag, an editor, and removal to a 30-day trash. Adult-only styles are ONE lock tile until the admin enters their own passcode; leaving the tab relocks. |
| S6 | The two adult-only-style switches become one (`generation.styles.adult_only`). The two Quick and Detailed keys become `generation.picture_tier` and `generation.video_tier` (the names `resource-tiers-2026-10-27.md` section 11 already chose). Four keys that nothing reads leave the screen. Every move is spec first (section 8). |
| S7 | Nothing in Styles ever reaches a child or a teen. The area is admin only, and no other screen lists a style: Models and storage and the free-up dialog stop listing style files. |
| S8 | Chat does not install, mark, share or unlock styles (admin, outbound and passcode work). Chat uses styles by name through `generate_video` and `edit_video` (VIDEO-LORA-10); nothing in this area has a chat twin to keep in step. |

## 1. Supersedes and amends

| Document | What changes |
|---|---|
| [video-loras-2026-11-02.md](video-loras-2026-11-02.md) D2 and section 5.1, "Settings, Home settings, Pictures and videos, **Styles**" | The place is Settings, **Pictures, videos and music**, tab **Styles**. The card list becomes the list of section 5 here. "Actions" become the buttons and dialogs of section 5. |
| same, section 5.2, key `generation.video.lora_sources` | Replaced by `generation.styles.civitai` (boolean, default off) and `generation.styles.civitai_key` (secret). Hugging Face is not a setting: it is the default source and cannot be turned off from here. The key never shipped, so no data moves. |
| same, section 5.3 item 3, "the Settings card shows the plain cause" | The cause shows on the installing row and on the Repairs item, in the plain lines of section 5.4. |
| same, section 4.4, "A Civitai personal API key (and a Hugging Face token ...) is stored in Home through `lib/secrets`" | The Hugging Face token is the existing household secret `voice.hf_token` (AI and models, Advanced), used for styles too: one token, one place. Its label becomes "Hugging Face token". Only the Civitai key is new. |
| same, section 1 row for `generation.video.adult_adapters`, and [image-engine-2026-10-17.md](image-engine-2026-10-17.md) section 6 `generation.adult_adapters` | One key for pictures and videos, `generation.styles.adult_only`. Meaning unchanged: "Hidden" hides every adult-only style from everyone, admins included. Migration in section 8. |
| same, section 13, row "Household switches" | The two switches collapse into one; the others stay as written. |
| [video-generation-2026-10-17.md](video-generation-2026-10-17.md) section 13, "the Settings section **Quick and Detailed videos**: what each is, **Get Detailed videos (size)**, the licence dialog, **What is the difference?**, **Details**", and sections 14 and 15 where they describe Settings copy | Deleted. The install and the licence step already live on the Models and storage row, which is the one home. "Who can make videos" and the video library list are replaced by section 3 and section 5 here. |
| [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) section 11, "`generation.picture_quality` and `generation.video_quality` ... become `generation.<category>_tier`" | This note executes it for pictures and videos (section 8). Section 9, "Settings holds only the defaults", is the rule the new Videos and Pictures tabs follow. |
| [settings-ia-2026-10-18.md](settings-ia-2026-10-18.md) rows H4 (Pictures, videos and music) and the `media-library` row | H4 is the four tabs below; `media-library` is removed. |
| same, section 3.4 "Household settings, Styles (the settings area is the page ...)" | The Styles **tab** is the page: the view relocks when it unmounts (section 5.1 here). |
| same, section 5.1 "'Adult' never as a badge" | After unlock an "Adults only" chip is drawn on an open adult-only row and the editor's switch shows it; locked, nothing is drawn. |
| [settings-ia-2026-10-18.md](settings-ia-2026-10-18.md) row P6 (Account, Pictures and videos) | Removed with the Yours page (section 8). |
| [ai-models-glance-2026-10-26.md](ai-models-glance-2026-10-26.md), the Quick, Detailed and music.make rows | The Quick or Detailed radio leaves the AI card; `music.make` becomes a state line plus a link to the Music tab. |
| [content-policy-2026-10-18.md](content-policy-2026-10-18.md) key table, [image-editing-2026-10-17.md](image-editing-2026-10-17.md) section 7, backlog row PEOPLE-PROMPTS-01 | `generation.people_prompts` is retired; `generation.household_likeness` stays. |
| open row SETTINGS-IA-04 | Amended: the tabs of this page come from VIDEO-SETTINGS-03 and 05; that row does not redo them. |
| IMGGEN-SET-01 and VIDEO-GEN-04 (the two views `PicturesLibrary` and `VideoLibrary`) | Both views are deleted and replaced by the tab views of section 7. Their style lists move into the Styles tab (VIDEO-LORA-08). |
| `docs/user/pictures.md`, `settings.md`, `people.md` and `videos.md` wording about "Install the picture model", "Quick and Detailed" and the style library | Rewritten in the slice that changes the screen (same commit as the behavior). |

No rule in `docs/design/RULES.md` is changed. Rules 0 and 10 (the lock hides, it blocks nothing an adult may make), rule 8 (a minor gets no level
choice), S1 to S6 and rule 9b are followed as written (section 11).

## 2. Audit

Opened on a dev hub in this worktree (Sage, owner), the Stack answered by a scripted stand-in with three video styles (one adult-only), a
component list and the picture status, at 1440 dark and light and 390 light, plus AI and models, Advanced and Performance. Screens:
[now-pictures-tab-1440-dark](assets/settings-media-2026-11-02/current/now-pictures-tab-1440-dark.jpg),
[now-pictures-tab-1440-light](assets/settings-media-2026-11-02/current/now-pictures-tab-1440-light.jpg),
[now-pictures-tab-390-light](assets/settings-media-2026-11-02/current/now-pictures-tab-390-light.jpg),
[now-media-library-tab-1440-dark](assets/settings-media-2026-11-02/current/now-media-library-tab-1440-dark.jpg),
[now-models-and-storage-1440-dark](assets/settings-media-2026-11-02/current/now-models-and-storage-1440-dark.jpg).
The pane showed no Stack-specific rows other than those the stand-in sent; a real Stack may list more components (not verified).

### 2.1 What exists today

The area is `media` in `spec/settings/areas.json` (pinned `spec-v0.1.313`), two cards (`household.pictures`, `household.media_online`) and two tabs, both
admin only. Tab `pictures` ("Pictures, videos and music", view `home.pictures_library`) and tab `media-library` ("Media library", view
`home.media_library`). Both views are the same component (`PicturesLibraryView` in `shell/pages/settings/settingsViews.tsx`), which draws
`PicturesLibrary` and then `VideoLibrary`. The page, top to bottom: Quick and Detailed pictures, Who can make pictures, Styles (list), Add a style,
Quick and Detailed videos, Who can make videos, Video styles (list), Add a video style, then the keys card (14 rows plus 4 folded music lookups),
then Online radio and podcasts (3 rows). About 4,700 px tall at 1440 wide; the screenshot is one page of scrolling.

### 2.2 Repeats (the same thing in two places, or twice on one page)

1. **The Media library tab is the Pictures tab again** (screenshots `now-media-library-tab`). It carries no library: the keywords `folder`, `nas`, `add videos`, `add music`, `library` in the area promise controls that no key or view provides (no `library` or `folder` key exists for media in the spec).
2. **Two adult-only-style switches** for one idea: `generation.adult_adapters` ("Adult-only styles", `settings/pictureKeys.ts`) and `generation.video.adult_adapters` ("Adult-only video styles", `settings/videoKeys.ts`). Both are on the same card.
3. **Two style lists and two add forms** (`PicturesLibrary` StyleRow and AddStyle; `VideoLibrary` StyleRow and AddStyle): the same fields (name, licence text, read checkbox, "fine for all ages?", trigger words), three source choices in one and a file only in the other.
4. **Styles are also listed on Models and storage** as the group "Styles you added", each with an Uninstall button (`ModelsAndStorageSection.tsx`, group `loras`; Stack `components.ts` `loraView`). A third place to remove the same file.
5. **Detailed is installable in two places**: the button "Get Detailed videos (74 GB)" with its own licence dialog in `VideoLibrary.tsx`, and the Install button on the Models and storage row "Video: Detailed (LTX-2.3)". Same job, same licence record. Same for "Get Detailed pictures".
6. **Which level chat uses is set in a place the page cannot show.** The two sections say "Pick which one chat uses in the Picture quality setting above" and "... Video quality setting above". Neither key is on the page: `generation.picture_quality` and `generation.video_quality` live in `household.ai_pictures` and `household.ai_videos`, which no card draws. They are drawn only as a Quick or Detailed radio on the AI and models job cards (`shared/aiChoices.ts` ids `videos.quick`, `videos.detailed`; also the setup wizard's plan step). A pointer to a control that is not there.
7. **The tier switches repeat the model sections**: Boost and Max on or off per category are on AI and models (TIER-HOME-04), while this page also says what "Detailed" is and installs it.
8. **"Adults can make songs" is a second control of the same key**: `generation.music.enabled` is a switch on the AI and models music card ("music.make", `SETTING_ONLY_SWITCHES` in `routes/aiChoices.ts`) and is declared in `household.ai_music`, not on this page. Only one screen can hold it.
9. **Children's limits are split from their switch**: `generation.kids` and the two daily limits sit in a 14-row card far from the sentence about children in each "Who can make" table.

### 2.3 Obsolete terms and behaviour

- **Quick and Detailed** (pictures and videos): `PicturesLibrary.tsx` and `VideoLibrary.tsx` section titles, both comparison tables, "Get Detailed ...", the licence dialog title "Before you get Detailed videos", `kindOfBase`, `kindOfModel`; key labels and option copy of `generation.picture_quality`, `generation.video_quality`, `generation.picture_quick_model` ("Quick picture model"); `generation.music.length` option "Quick" (it means a short song, not a level); Models and storage rows "Video: Quick (Wan 2.2 FastWan 5B)" and "Video: Detailed (LTX-2.3)" (Stack `components.ts` LABELS); AI job card "Using Quick" and "Using Detailed" (`shared/aiChoices.ts` line 219).
- **The Quick description for adults is wrong now.** "5 seconds with no sound, in about 2 minutes. Can start from a picture" describes the old Wan clip. An adult's Standard is LTX-2.5 with sound and up to 10 seconds ([video-tiers-2026-11-02.md](video-tiers-2026-11-02.md) section 3). Only a child's or teen's clip is silent Wan.
- **"Wan 2.2 FastWan 5B ... Uses about 44 GB of memory" and "LTX-2.3 (with the Gemma 3 text encoder)... about 44 GB"** in the Details fold: LTX-2.3 is not the video family any more, the figures are not the measured ones (Standard 39.4 GB, Max 48.6 GB), and the fold is resource talk on a page that is not the place for it.
- **"Children cannot make videos" and "Teens cannot make videos", with disabled switches, and the line "Videos are off for children and teens. No setting turns them on"** (`VideoLibrary.tsx` `WhoMakesVideosSection`; `routes/videos.ts` `minors`). False in the code: `videoDenial` reuses `pictureDenial`, which lets a teen and a cartoon-lane child through; `chooseVideoQuality` sends `quickOnly` for them; `generation.kids_daily_videos` ("Cartoon videos a child can make each day") exists. The stale comment at the top of `lib/videos/policy.ts` ("never a child or a teen") has the same error.
- **The picture and video help lines** "Children and teens cannot, whatever this says" (`generation.adults`, `generation.video.enabled`) are wrong for teens and for cartoon-lane children. The same line on `generation.music.enabled` is correct (`musicViewDenial` makes songs adults only) and stays.
- **"Teens ... only get all-ages styles"** (picture band note) contradicts D3 of the LoRA note: a minor never sees any style.
- **Old install model for styles**: "Hugging Face link", "A file from this computer (up to 120 MB)", "A file already on this computer (for big files)" as three radio buttons, a typed licence string, "Not sure" as an age answer. The browser, the confirm panel and the Adults only question replace them.
- **Keys that nothing reads** (searched `backend/src`, `frontend/src`, `shared`; only the spec and tests mention them): `generation.people_prompts` ("Ask me before making pictures and videos of people": `image-editing-2026-10-17.md` section 7 says it is no longer read for an adult, and rule 10 says Home asks nothing about people), `generation.household_likeness` ("Family can make pictures and videos of each other": its help says an admin can turn it off, and nothing checks it), `engines.video.choice` and `engines.music.choice` (absorbed by the tier slots; no reader). `generation.picture_quick_model` and `generation.picture_detailed.enabled` are still written by the AI card, copied into the slots by `lib/tierSlotMigration.ts` and read by `lib/aiChoicesState.ts` and `shared/aiChoices.ts`.
- **Wrong person-area page**: Settings, Yours, **Pictures and videos** ("Pictures and videos that look like you") holds one row, `generation.kid_enabled`, whose label reads "This child can make cartoon pictures and videos". An owner sees it about herself. A parent sets it for a child on the child's Family page already (`personLimits.ts`).
- **A denial line that sends a child to settings**: `VIDEO_DENIAL_LINE.minor` tells the child "A parent can turn it on in Settings, Pictures, videos and music" (`lib/videos/policy.ts`). The switch is not there for videos.

### 2.4 Things people should not see

- **Adult-only style names.** The video list, the picture list and Models and storage each print the style's name, licence, size and trigger words, with a red "Adults only" badge; a bystander at an admin's screen reads them (screenshots `now-pictures-tab` and `now-models-and-storage`, the style "Hidden example"). Against the owner's rule: no title, picture or description while locked. Also the trigger words field in the add form, and a failed add's message, can carry a name.
- **Resource words in Details**: "Uses about 44 GB of memory while it makes a clip" (admin-only area; allowed for an admin by the rule, but wrong and unneeded here, see 2.3).
- **The fingerprint block** (a full SHA-256 in the "Check this before you turn it on" alert) is a developer fact; it moves under Details.
- **No non-admin ever sees this area** (min role admin); the exposure is to an admin's bystander, not to a person without the role.

### 2.5 Missing

- The LoRA browser, the install job with progress, the import with a confirm panel, per-style availability (Only admins, All adults, Chosen people), the Adults only flag with an explicit lowering step, editing add-ins and strength, the 30-day trash, the one lock tile. None exists. Today a new style is on for everyone who can make videos after one "Turn it on" click, which is the opposite of the owner's rule (admin-only until marked).
- A way to try a style as an admin before sharing it.
- A source switch with a plain notice for Civitai, and a place for its key.
- A pointer from each media kind to where its models are chosen.
- Music has no home of its own: songs, the four lookups and radio sit in one card with picture settings.

### 2.6 Where each key and label is today

| Key | Label today | Declared in | Drawn on | Verdict |
|---|---|---|---|---|
| `generation.adults` | Adults can make pictures | `settings/pictureKeys.ts` | keys card | keep; new help; Pictures tab |
| `generation.adult_adapters` | Adult-only styles | `pictureKeys.ts` | keys card | merge into `generation.styles.adult_only` |
| `generation.video.adult_adapters` | Adult-only video styles | `videoKeys.ts` | keys card | merge (same) |
| `generation.video.enabled` | Adults can make videos | `videoKeys.ts` | keys card | keep; relabelled "Video making" (it covers every lane); new help; Videos tab |
| `generation.music.enabled` | Adults can make music | `musicKeys.ts` (`household.ai_music`) | AI card switch only | move to Music tab; the AI card shows state |
| `generation.music.length` | Song length (Quick, Full) | `musicKeys.ts` | keys card | keep; option labels Short and Full |
| `generation.picture_quality` | Picture quality (Quick, Detailed) | `pictureKeys.ts` | AI job card radio | replace by `generation.picture_tier` |
| `generation.video_quality` | Video quality (Quick, Detailed) | `videoKeys.ts` | AI job card radio | replace by `generation.video_tier` |
| `generation.picture_quick_model` | Quick picture model | spec | nowhere (read and copied by the card code) | retire after the card writes the slot directly (VIDEO-SETTINGS-04, -09) |
| `generation.picture_detailed.enabled` | Detailed pictures | spec | AI card switch | retire after the switch writes `engines.image.tier.boost` (VIDEO-SETTINGS-04, -09) |
| `engines.video.choice`, `engines.music.choice` | Video model choice, Music model choice | spec | nowhere | retire (no reader) |
| `generation.household_likeness` | Family can make pictures and videos of each other | spec only | keys card | rule 0 names this option, so it stays on the Pictures tab; it has no reader today, and VIDEO-SETTINGS-04 adds the reader and its test |
| `generation.people_prompts` | Ask me before making pictures and videos of people | spec only | keys card | retire |
| `generation.kids` | Let kids make cartoon pictures and videos | `pictureKeys.ts` | keys card | keep; Children card |
| `generation.kids_daily_pictures`, `generation.kids_daily_videos` | Cartoon pictures/videos a child can make each day | `pictureKeys.ts` | keys card | keep; Children card |
| `generation.kid_enabled` (person) | This child can make cartoon pictures and videos | `pictureKeys.ts` | Yours, Pictures and videos | stays on the child's Family page only; the Yours page is removed |
| `music.lyrics_online`, `music.musicbrainz_match`, `music.artist_wikimedia`, `music.album_art_online` | four lookup switches | `musicKeys.ts` | folded under the keys card | keep; Music tab, folded |
| `radio.directory.enabled`, `podcasts.directory.enabled`, `podcasts.directory.teens` | Find radio stations online, Find podcasts online, Let teens find podcasts | package settings | second card | keep; Music tab |
| `voice.hf_token` | Hugging Face token (for voice cloning) | `routes/voice.ts` | AI and models, Advanced | keep; relabel "Hugging Face token" |
| `engines.<video or music>.tier.*`, `resources.*` | Video at Boost, Lower video quietly, and so on | `lib/tiers.ts`, `PerformanceCustomize.tsx` | AI and models | stay (correct home) |
| `audio.speed.video` (person) | Video speed | spec | nowhere in Home | outside this area; no reader found, left to the player note |

## 3. Information architecture

```
Settings, The home, Pictures, videos and music   (admin)
  Pictures   a Choose models link, adults on or off, Children and teens card
  Videos     adults on or off, level when nobody says, a Choose models link, a pointer to Styles
  Music      adults on or off, song length, a Choose models link, Radio and podcasts, four folded lookups
  Styles     browser, list, sources, adult-only switch, recently removed
```

Where each old thing went:

| Old | New home | Note |
|---|---|---|
| Quick and Detailed pictures, Quick and Detailed videos sections, both tables, both Details folds | deleted | levels are explained once, on the Create screens and in AI and models |
| Get Detailed pictures, Get Detailed videos, the Install the picture model button | Models and storage rows (already there) | the Choose models link opens them |
| Who can make pictures, Who can make videos (disabled switches) | one sentence each (section 4) | no fake controls |
| Picture styles list, video styles list, both add forms | Styles tab | one list, one flow |
| Models and storage group "Styles you added" | removed from Models and storage | Styles tab is the only list; server also stops sending style files in the component list and the free-up dialog |
| `generation.adult_adapters`, `generation.video.adult_adapters` | Styles tab, "Adult-only styles" | one select |
| `generation.picture_quality`, `generation.video_quality` and the AI job-card radio | Pictures and Videos tab rows "Level when nobody says" (`generation.picture_tier`, `generation.video_tier`) | the AI card keeps the per-slot switches and models |
| `generation.music.enabled` | Music tab | the AI card shows "On" or "Off" and a link |
| Media library tab | deleted | |
| `generation.kids`, caps | Pictures tab, card Children and teens | covers pictures and videos |
| `generation.people_prompts` | retired (nothing reads it) | see section 8 |
| `generation.household_likeness` | Pictures tab, card Children and teens, row "Family can make pictures, videos and songs of each other" | stays; its reader is added (section 8) |
| Yours, Pictures and videos page | removed (section 8) | |

Counts: Pictures 7 rows, Videos 4 rows, Music 3 rows plus 3 radio and podcast rows plus 4 folded, Styles 4 groups. Each tab is far under the "about fifteen keys per screen" cap of SETTINGS.md rule 6, and the page is no longer 4,700 px.

## 4. Exact copy

Teens have no switch of their own: a teen makes pictures and videos while the household switch for that kind is on (the video switch covers every lane; the picture switch covers adults only, so a teen can always make pictures). A teen switch would be a new age-gate design, not copy, and is not proposed here.

Plain words, grade 6, no resource words on any row an admin could read aloud to a family member. Every string below goes through the spec
(`copy` fields, `describeSetting`, S5); a view writes no help of its own. The three link rows carry no live state, so the spec holds their text too.

### 4.1 Pictures tab

| Row | Label | Help |
|---|---|---|
| Card heading | Pictures | Who can make pictures, and which models make them. |
| `generation.adults` | Adults can make pictures | Turns picture making on or off for adults. Teens can always make pictures with nothing adult in them. Children are set below. |
| link row | Picture models | Choose which models make Standard and Boost pictures. Button **Choose models** (opens AI and models, Overview). No live state: AI and models already shows it. |
| `generation.picture_tier` | Level when nobody says | Standard is fast. Boost has finer detail and takes longer. Anyone can pick a level for one picture. |
| Card heading | Children and teens | Children make safe cartoons. Teens make pictures and videos with nothing adult in them. Neither sees styles. |
| `generation.kids` | Let children make cartoon pictures and videos | Children get cartoons with no sound, up to the limits below. Photos, real people and anything scary or grown-up are never made for them. |
| `generation.kids_daily_pictures` | Cartoon pictures a child can make each day | 0 means none. |
| `generation.kids_daily_videos` | Cartoon videos a child can make each day | 0 means none. |
| `generation.household_likeness` | Family can make pictures, videos and songs of each other | Anyone in the home may make things with or of any household member. Turn it off to stop that. |

### 4.2 Videos tab

| Row | Label | Help |
|---|---|---|
| Card heading | Videos | Who can make videos, and how. |
| `generation.video.enabled` | Video making | Turns video making on or off for everyone in the home, children and teens too. Children's daily limits are under Pictures. |
| `generation.video_tier` | Level when nobody says | Standard is fast and has sound. Boost has a sharper picture and takes a little longer. Anyone can pick a level for one video. |
| link row | Video models | Choose which models make Standard, Boost and Max videos. Button **Choose models** |
| description of the card (spec copy, S5) | | Max is for the people you allow. Videos are never made on a spoken turn, a shared screen or for a guest. |
| row | Styles | Add, share and remove styles. Button **Open Styles** (switches tab) |

`generation.video_tier` and `generation.picture_tier` are selects with Standard and Boost only (Max is never a household default,
resource-tiers section 11). Reduced is not offered. A level whose slot is `off` is hidden from the select (the slot rule of section 3a there).

### 4.3 Music tab

| Row | Label | Help |
|---|---|---|
| `generation.music.enabled` | Adults can make songs | Turns song making on or off for adults. |
| `generation.music.length` | Song length | What chat makes when nobody says. Anyone can ask for the other kind. Options **Short** (the hook, the first verse and the chorus) and **Full** (every part). Option ids stay `quick` and `full`, so nothing migrates. |
| link row | Song models | Choose which models make songs. Button **Choose models** |
| Card **Radio and podcasts** | Find radio stations online, Find podcasts online, Let teens find podcasts | unchanged text |
| Folded **Looking up songs online** (4) | the four existing lookup switches | unchanged text; they are admin facts about what leaves the home |

### 4.4 Styles tab

- Intro: "A style gives pictures and videos a look, like old film or clay. Only admins add styles. A new style is for admins only until you say who else can use it."
- Buttons: **Browse styles**, **Add from a file**. Empty list: "No styles yet. Browse styles to find one, or add one from a file."
- Row: picture, name (an Adults only chip only after unlock), line "Style, Videos, Works at Standard, Boost and Max" (or "Made the older way, Boost only"; "Waiting for an admin to say what it is made for" when the base is unknown, in which case the row is greyed), and a select **Only admins / All adults / Chosen people**. The lock row is the kit `LockedSettingRow`, after the open rows, text from the kit (**Locked items**). Under the list: "Adult-only styles stay locked until you enter your own passcode." (locked) or "Unlocked on this page only. It locks again when you leave or after 2 minutes without a touch." (unlocked).
- **Where styles come from** card. Hugging Face: "On. Search and download styles from Hugging Face. A token is only needed for styles that ask you to accept terms: add it in AI and models, Advanced. Home sends it only for those files." Civitai switch (`generation.styles.civitai`): "Off until you turn it on. This computer only contacts civitai.com when you search or install." Turning it on opens the notice: "Turn on Civitai? When you search or install, this computer contacts civitai.com. It sends what you typed and your key, nothing about your family. Civitai has its own rules. Some styles there are for adults only, and some may show real people. You choose what to install." **Not now** and **Turn on**. When on, a **Civitai key** row (secret, write only, **Replace**, **Remove**): "Some downloads need a free Civitai key. Home keeps it private and never shows it again."
- **Adult-only styles** (`generation.styles.adult_only`): options **Allowed** and **Hidden from everyone**. Help: "Hidden removes every adult-only style for all adults, admins too, until you switch it back. Nothing is deleted."
- **Recently removed**: "Removed 3 days ago. Deleted for good in 27 days." **Restore** and **Delete now** (frees the space at once, with a confirm). Adult-only removed styles are in the same single lock row.

## 5. The Styles screen, end to end

Mockups: `styles-*`, `unlock-*`, `styles-open-*`, `browse-*`, `confirm-*`, `detail-*` in the assets folder.

### 5.1 The list and the lock

The tab view asks `GET /api/loras` (VIDEO-LORA-03). The server returns each open style as a full row and every locked one as nothing but a
`locked: true` entry, which the view collapses with the kit's `collapseLocked` into one `LockedSettingRow` (no count, no name, no size, no
"making" detail except the kit spinner while an adult-only install runs). The installing job of an adult-only style is the same locked
tile with the kit spinner; an all-ages install is an ordinary row with the kit `JobProgress` (its own card, S6).

The tile opens the kit `AdultLockDialog` (the shell's `AdultLockProvider`, passcode or password by the person's own sign-in secret,
lockout countdown from `usePasscodeAttempt`). On unlock the list refetches (the host resets queries) and adult-only styles appear with
their names, pictures and an Adults only chip. **Relock on leaving the tab.** The shell relocks on a route change, but a tab is a `?tab=`
query on the same route, so the Styles view calls `relock()` from `useLockProof` when it unmounts (and the shell's "Lock now" button, the
2-minute idle clock, the hidden-tab rule and the 15-minute cap apply as built). Moving to Pictures, Videos or Music therefore relocks.
An adult-only style is never drawn on those three tabs.

### 5.2 Browse (admin only, outbound only on a click)

The **Browse styles** dialog (kit `Dialog` `variant="flow"`, full screen on a phone as shipped) shows a search box, a source switch (Hugging Face; Civitai greyed and
labelled "off" until enabled), a Made for switch (Videos now; Pictures appears when VIDEO-LORA-12 lands), a sort (Most downloaded, Newest,
and Top rated on Civitai), and a grid of the kit `MediaShelf` tiles: picture, name, creator, downloads, base in words ("LTX-2.5"), size.
Pasting a Hugging Face link into the search box opens that style's confirm panel directly. Results the source marks adult
(Civitai `nsfw` or `nsfwLevel` above 1, Hugging Face `not-for-all-audiences`) arrive as locked entries and draw as the kit lock tile in the
grid. A **Show adult results** switch appears only while unlocked, is off at each visit, and is the only thing that sends `nsfw=true`.
Requests, limits, cache and back-off are `lib/loras/source.ts` as the LoRA note section 5.2 decided (one request per 2 seconds per host, 60
a hour, 5-minute cache, one download at a time). Plain lines for each state: no match ("No styles match. Try fewer words."), a limit hit
("Searching too fast. Try again in a minute."), a region filter ("Civitai is not showing adult styles from here. Nothing is wrong with
Home."), a gated Hugging Face file ("This style asks you to accept terms on Hugging Face first. Open its page, accept, then add your token in
AI and models, Advanced."). The hub fetches previews once and serves them from its own address; a family browser never contacts a style site.

### 5.3 The confirm panel and the install

Pick a result (or add a file) and one panel opens: picture, name (editable), source link, size, **Made for** (what the file says and what the
source says, and a plain mismatch line if they differ), licence line with, when the licence is not an open one, the checkbox "I have read the licence
and it lets us use this style at home" (required to continue), and **Is this style for adults only?** with **Yes, adults only** and **No, all
ages**. The pre-set is always Yes. The source's own flag only changes the line under it ("The source marks this adult." or "The source says
nothing about age."); the source never sets No (D4). A file whose base is unknown asks "What was this style made for?" (LTX-2.5, LTX-2.3, I do not
know); "I do not know" installs it greyed. Line under the buttons: "It starts for admins only. You choose who else can use it after you try it."

**Install style** calls the VIDEO-LORA-07 install route, which starts the Stack's `video.lora.install` job. Progress is the existing strip
("Downloading a style", never the name) and the row's own `JobProgress`. A failure raises a Repairs item for the owner and admins with
**Try again** and shows the same sentence on the row (S6, no new surface):

| Cause | Sentence |
|---|---|
| no space | There is not enough space to install this style. Free up space in Backups, storage and updates, then try again. |
| over 4 GB | This style is bigger than the 4 GB limit, so it was not installed. Pick a smaller one. |
| fingerprint differs | The file did not match what the source said it should be, so it was thrown away. Try again, or pick another style. |
| source refused | The source would not let this computer download it. Try again later. |
| key or token needed | The source needs a key or token. Add one in Styles, Where styles come from (Civitai) or in AI and models, Advanced (Hugging Face), then try again. |
| wrong base | This style was made for something Home cannot use yet. Pick one made for LTX-2.5 or LTX-2.3. |
| not a style file | That file is not a style Home can use. Styles come as .safetensors files. |
| already installed | You already have this style. (Opens its row.) |

For an adult-only install each sentence shows only after unlock; before it the Repairs item says "A style did not install" with the same button.

### 5.4 Add from a file

A dialog with two sources (a file up to the hub's 120 MB upload limit, or "A file already on this computer" with its path for larger ones, as
the picture form has today) feeds the same confirm panel. Nothing else from the old forms survives (no typed licence text, no "Not sure").

### 5.5 The style editor

A row opens the style editor in a kit `Dialog` `variant="flow"` (full screen on a phone as shipped; the kit `Sheet` is not used). A dialog, not a route, so an unlocked page is not left. Sections: **About** (name,
"What it does" at most 140 characters, kind Style or Character or Motion, picture); the buttons **Try this style** (opens Create with the style
chosen through router state, never a URL id, so an adult-only style's id is not kept in browser history; VIDEO-LORA-09 reads it) and **Remove**; **Who can use it** (radio Only admins, All adults, Chosen people with the kit
`PersonMultiSelect` listing adults only, so a minor id can never be written) and the **Adults only** switch; **Added to the prompt** (words that
switch it on, trigger position under More, "Also add" phrases at most 120 characters and 400 in all); **Avoid** with **Say instead** (shown only
as the pair the LoRA note D9 defines; the editor says "Videos at Standard and Boost cannot use avoid words. Say the opposite instead." until
`negative_prompt: "nag"` is reported); **Strength** (Normal, lowest and highest allowed; the Create control stays Less, Normal, More); **Details** (source
link, licence and who accepted it, made for, size, fingerprint) and **Check the file again**. Saving is live with the kit's field-level
apply. The three phrase lists use the one new kit part, `PhraseListField` (kit gap G1).

**Adults only.** Turning it on needs no confirmation and no passcode (marking more is always free) and locks every non-cleared item made with it
(ADULT-LOCK-06). Turning it off asks: "Make this style all ages? Everyone who can use it will see its name and picture without a passcode. Clips
already made with it stay locked until the person who made each one unlocks them for good. People under 18 still never see styles." **Make all
ages** and **Keep adults only**. An open adult-only style editor is also the only place to lower it, so the lock is already open.

**Availability.** Only admins is the default of every new or migrated style. All adults and Chosen people write `availability`. A minor id is
refused by the writer. Changing a style to adult-only while someone is playing a clip made with it stops that clip and relocks (section 3.9 item 5
of the LoRA note, already built in ADULT-LOCK-05).

**Remove.** "Remove this style? Its file moves to Recently removed for 30 days, then it is deleted. Clips already made with it stay." Restore is one
tap (behind the lock for an adult-only style). After 30 days the Stack deletes the file and Home drops the record.

### 5.6 What each person sees

| Person | Settings, Styles | Elsewhere |
|---|---|---|
| Owner or admin | the whole tab | Create picker shows styles marked for them; adult-only behind the lock |
| Adult who is not an admin | no Settings entry for this area | Create picker shows the styles marked for them (All adults or Chosen people) |
| Teen, child, guest, spoken turn, shared screen | nothing (route 403, area hidden) | no style anywhere: Create picker group absent, tool description lists none, no Styles row on any list |

## 6. Chat parity

- Styles in chat: `generate_video` and `edit_video` take `styles` (VIDEO-LORA-10). Nothing in this note changes that.
- Chat does not install, browse, mark, share or unlock a style (S8). Reasons: the install is an admin's outbound action with a licence step, marking changes who may see adult items, and the unlock needs the person's own passcode on their own screen.
- No other setting in the area has a chat tool today (there is no settings tool in `backend/packages`; `lib/operatorSettings.ts` denies the `generation.` prefix to assistant keys on purpose). The one place chat words and Settings words must agree is the level: the tool's `quality` argument keeps `quick` and `detailed` as internal ids (`generate_video` maps quick to Standard and detailed to Boost, as built); the model-facing description and every person-facing line say Standard, Boost and Max. The household default (`generation.video_tier`) is what the tool uses when the person names no level, exactly as `householdVideoQuality()` does today.
- Denial lines point at the right place. `VIDEO_DENIAL_LINE.minor` becomes "Making videos is off for this profile. A parent can turn it on." (no path, no settings word); the video `household_off` line becomes "Making videos is switched off in this home. An admin can switch it on in Settings, Pictures, videos and music." (a teen or child gets it too); the picture line stays.

## 7. Reuse check

| Need | Already exists | Decision |
|---|---|---|
| Areas, tabs, rows, copy | kit `SettingsShell`, spec `areas.json`, `describeSetting`, `SettingRow` | Reuse. Four tabs, cards by group. No Home layout. |
| Link row to AI and models | kit `Item` with `ItemActions` and `Button` | Reuse as shipped, text from the spec. The state of the models stays on AI and models (S6: one source, no copy of the rule here). |
| Rows | Style rows and link rows are drawn where they are used, as kit `Item`, `ItemGroup` and `LockedSettingRow` (the browse grid as `MediaShelf`). No Home `StyleRow`, `StatusRow` or `*Card` component has a kit part as its root (9b). | |
| Style list row, lock row | kit `Item`, `ItemGroup`, `LockedSettingRow`, `collapseLocked` | Reuse. |
| Unlock dialog, relock, Lock now | kit `AdultLockProvider` and `AdultLockDialog` mounted by the shell (`AdultLockHost.tsx`) | Reuse. One new Home hook `useRelockOnLeave` (a `useEffect` cleanup calling `useLockProof().relock`). |
| Browse grid and tiles with a locked entry | kit `MediaShelf` (locked entries become the one tile), `MediaTile`, `Dialog` | Reuse. |
| Search box, switches, sort | kit `Input`, `ToggleGroup`, `Select`, `Pagination` | Reuse. |
| Progress on install | the progress strip, kit `JobProgress`, Repairs with Try again | Reuse (S6). No new surface, banner or poller. |
| People chooser | kit `PersonMultiSelect` (`settings/`) | Reuse, adults only. |
| Style editor | kit `Dialog` `variant="flow"`, `Field`, `Slider`, `AlertDialog` | Reuse as shipped; no new kit variant. |
| Phrase list (words, add-ins, avoid, say instead) | the vendored `combobox.tsx` ships `ComboboxChips` (chips with add and remove) but no per-item and total character limits, duplicate refusal, paste splitting or free text with no option list | **Kit gap G1** (below), built on `ComboboxChips`. |
| Hugging Face token | `voice.hf_token` and `HuggingFaceTokenSection` | Reuse; relabel. |
| Civitai key | the write-only secret field flow of `HuggingFaceTokenSection` | Reuse the pattern for a second key. |
| Licence acknowledgement for the model packs | LICENCE-ACK-01 (household acknowledgement, never asked as a question) | Reuse unchanged; styles keep their own per-file licence line. |
| LoRA record, access, routes | VIDEO-LORA-02 and 03 | Extended (section 9). |
| Source client, limiter, cache | `lib/loras/source.ts` (VIDEO-LORA-07) | Unchanged. |
| Old views | `PicturesLibrary.tsx`, `VideoLibrary.tsx` | Deleted when their content has a new home (their tests move or go with them). Port before delete (the rulebook's rule): the install job polling and the licence dialog already exist as the Models and storage row code, so nothing is lost with the old views. |

**Kit gaps and the exact commons additions (rule 9b, kit first, its own worktree, tag, then a Home pin).** There is one.

- **G1: `PhraseListField`** in `ui/src/settings/PhraseListField.tsx`. Props: `label`, `help`, `value: string[]`, `onChange`, `maxItems?`, `maxItemChars`, `maxTotalChars?`, `addLabel`, `disabled?`, `invalid?`. Built on `ComboboxChips` (chips, remove, keyboard), adding free text with no option list; draws removable chips and an inline "Add" input; Enter or comma adds; a paste of a comma list splits; duplicates (case-insensitive) are refused with the kit's field error line; the per-item and total limits show a live count ("120 characters each, 400 in all"). Accessible: the list is a labelled group, each chip's remove button is named "Remove <phrase>", an add announces through a polite live region. No colour of its own. A UI-DECISIONS.md ledger row: "a list of short phrases is `PhraseListField`; Home writes none". Tests in the kit: limits, duplicate, paste split, keyboard, a11y. Nothing else in the note needs a kit change: the lock tile, `LockedSettingRow`, `MediaShelf` locked entries and `AdultLockDialog` shipped in `ui-v0.5.486` (the pinned tag).

## 8. Key migration and spec flow (migrations are rules)

`lives_in` groups (S4, each group in exactly one card): `household.media_pictures` (`generation.adults`, `generation.picture_tier`), `household.media_kids` (Children and teens: `generation.kids`, the two limits, `generation.household_likeness`), `household.media_videos` (`generation.video.enabled`, `generation.video_tier`), `household.media_music` (`generation.music.enabled`, `generation.music.length`), `household.media_lookups` (the four folded `music.*` keys), `household.media_online` (unchanged), `household.media_styles` (`generation.styles.adult_only`, `generation.styles.civitai`, `generation.styles.civitai_key`), and `household.media_retired` (`generation.people_prompts` alone, listed under `not_placed`). The person group `person.likeness` (`generation.kid_enabled`, drawn on the Family page by `personLimits.ts`) is listed under `not_placed` with that reason when the Yours page goes. `household.pictures` ends up empty. Each of the Pictures, Videos and Music cards (and the Styles card) is drawn by a named view id added to `ALLOWED_VIEW_IDS` in VIDEO-SETTINGS-03, because the spec check refuses a card description with no view; the link-row text sits in that card's `copy` map. `not_placed` works per group, so no group mixes a retired key with a drawn one.

Order is fixed: spec first (commons `spec`), tag, Home pin bump, then Home declarations, readers and migration, then screens. `gen:settings`
is **never hand-run**: it writes the registry into whatever `MAIPAI_COMMONS_DIR` names. The slices use only the repo's flow: Home declares keys
in `backend/src/settings/*Keys.ts`; a key that is new to the pinned tag is listed in `scripts/settings-ahead-of-spec.json` until the spec tag
carries it; `check.sh` and the lander run the generator against a private scratch directory; the commons slice regenerates `keys.json` inside
its own commons worktree (`MAIPAI_COMMONS_DIR` set to that worktree by the slice's session, never to the shared checkout) and tags.

| Old | New | How the value moves |
|---|---|---|
| `generation.adult_adapters` and `generation.video.adult_adapters` | `generation.styles.adult_only` (`allowed`, `restricted`; default `allowed`) | One start-up step: `restricted` if either old value is `restricted`, else unset (the default). Both old keys are read for one release after the step runs, then dropped from the spec at the tag paired with the removal slice (the settings README's own rule for a retired key). The LoRA reader (`lib/loras/access.ts`) reads only the new key. |
| `generation.picture_quality`, `generation.video_quality` (`quick`, `detailed`) | `generation.picture_tier`, `generation.video_tier` (`standard`, `boost`) | `quick` becomes `standard`, `detailed` becomes `boost`, one to one (resource-tiers section 11). An unreadable value reads as `standard`. Readers (`policy.ts` x2, `quality.ts`, `aiChoicesState.ts`, `aiCopy.ts`) change in the same slice. If the saved level's slot is `off`, the select shows Standard and the reader falls back one tier with the note (section 3a, rule 7 of the tiers note). |
| `generation.picture_quick_model`, `generation.picture_detailed.enabled`, `engines.video.choice`, `engines.music.choice` | none | Not yet absorbed in code: the Detailed switch on the AI card writes `generation.picture_detailed.enabled` (`routes/aiChoices.ts` `SETTING_ONLY_SWITCHES`), `tierSlotMigration` copies every write of the old keys into the slots, and `aiChoicesState.ts` and `shared/aiChoices.ts` read them. VIDEO-SETTINGS-04 makes the card write `engines.image.tier.boost` and the Standard slot directly, removes the copy-on-write step and switches the readers; a test shows every stored old value is already in its slot; then the keys leave the spec (VIDEO-SETTINGS-09). |
| `generation.people_prompts` | none | Retired: nothing reads it and rule 10 says Home asks nothing about people. Its own group `household.media_retired` is listed under `not_placed` with that reason; stored values are dropped. |
| `generation.household_likeness` | same key | **Stays** (rule 0 names it: anyone in the household may make things with or of any household member, as an option that is on by default). Drawn on the Pictures tab now. VIDEO-SETTINGS-04 adds its missing reader (off stops a person being used in another's picture, video or song) with a test for on and off, ahead of anything else in that row. Retiring or hiding it would need Jesse's rule change; this note does neither. |
| `generation.music.enabled` | same key, new card `household.media_music` | `lives_in` change only. |
| `generation.music.length` option labels | same ids | copy only. |
| `generation.video.lora_sources` (planned in the LoRA note) | `generation.styles.civitai`, `generation.styles.civitai_key` | never shipped; nothing to move. |
| `video_adapter_prefs`, `picture_adapter_prefs` tables | the `loras` table | VIDEO-LORA-03 and VIDEO-LORA-12. Every existing style becomes Only admins. |
| Spec area `pictures` (Yours, "Pictures and videos") | removed; `legacy-sections.json` maps `pictures` to `profile` | `generation.kid_enabled` stays declared and drawn on the Family page. Yours drops to six pages, the lower bound `PAGE_COUNT_ENFORCED` allows (6 to 9). |
| Tab `media-library` | removed | an old `?tab=media-library` should open the first tab; VIDEO-SETTINGS-05 tests that the shell does so. |

No stored value is lost: every old value is read, mapped and kept until its successor has been written and a test proves the match; the
every retired key is first made unread, then dropped. Nothing here changes a stored record shape beyond the `loras` tables of VIDEO-LORA-03, which the
LoRA note already put spec first.

## 9. Server and data this screen needs

Routes (all `requireRole("owner", "admin")`, one definition in `routes/loras.ts`; the old `/api/videos/adapters` and `/api/pictures-admin` style
routes keep working until VIDEO-LORA-12 and delegate to it):

| Route | Does |
|---|---|
| `GET /api/loras` | open styles as rows; every locked one as `{ locked: true, making }`; availability, audience, made-for in words, state |
| `GET /api/loras/removed` | the trash, same lock rule |
| `POST /api/loras/browse` | `{ source, q, media, sort, cursor, adult }` through the one limiter; adult results locked unless a proof is present |
| `GET /api/loras/browse/:source/:id` | the confirm panel's facts (size, base, licence, source flags) |
| `POST /api/loras/install` | starts the Stack job; returns the job id |
| `POST /api/loras/import` | multipart file or a local path |
| `PATCH /api/loras/:id` | name, description, kind, availability, audience, add-ins, strength, preview |
| `POST /api/loras/:id/remove`, `/restore`, `/check` | trash, restore, re-hash |

`GET /api/components` stops returning `kind: "lora"` rows, and the free-up dialog stops listing them: the Styles tab is the only list, so no
name leaks through a second one. A route-sweep test (LoRA note test 1) covers `/api/loras`, `/api/components` and the picture routes.

## 10. Build slices

Rows are added to `docs/BACKLOG.md` under "Video generation" and the existing VIDEO-LORA rows are amended in place, not duplicated.

| Id | Size, repo | Slice |
|---|---|---|
| VIDEO-SETTINGS-01 | S, docs | This note, its mockup and screenshots, the backlog rows and the index line. |
| VIDEO-SETTINGS-02 | S, Home | Stopgap, before anything else: the three lists that print an adult-only style's name today (`GET /api/videos/settings`, `GET /api/pictures-admin`, `GET /api/components` lora rows) return the one locked entry for an adult-only style without a proof, and the two old views and Models and storage draw the kit `LockedSettingRow`. Test: LoRA note test 1 on these routes. |
| VIDEO-SETTINGS-03 | S, commons `spec` | `areas.json`: area `media` with the four tabs and new card groups, no `media-library`, section `pictures` removed with the legacy map; the five new keys (`generation.picture_tier`, `generation.video_tier`, `generation.styles.adult_only`, `generation.styles.civitai`, `generation.styles.civitai_key`); the copy of section 4 through the key `copy` fields; relabels; `not_placed` entries; `checkAreas` green; keys.json regenerated in the commons worktree; tag. |
| VIDEO-SETTINGS-04 | M, Home; after 03 | Pin bump; declarations in `*Keys.ts`; the migration of section 8 with its tests; readers switched; the dead-key check and its outcome; the three link rows; denial line copy. |
| VIDEO-SETTINGS-05 | M, Home frontend; after 04 | The Pictures, Videos and Music tab views and the Styles tab shell (today's lists moved, behind the lock, until VIDEO-LORA-08 replaces them); delete `PicturesLibrary.tsx`, `VideoLibrary.tsx`, `home.media_library`; AI job cards and the setup wizard say Standard and Boost; `docs/user` pages. Preview on a dev hub at 1440 and 390, light and dark. A banned-word test over the area's copy (Quick, Detailed, Wan allowed only in Models and storage; LTX base names, sizes and the 4 GB limit allowed on the Styles tab's browse tiles, confirm panel, failure lines and Details). |
| VIDEO-SETTINGS-06 | S, Stack | Component labels (`lib/components.ts`): "Video: Wan 2.2 FastWan (children's videos, no sound)", "Video: LTX-2.5 (Standard and Boost, with sound)", "Video: LTX-2.5 Max", "Video: LTX-2.3 (older styles)"; the `usedBy` lines; no Quick or Detailed word. |
| VIDEO-SETTINGS-07 | S, commons `ui` | Kit `PhraseListField` (G1), tests, ledger row, tag, Home pin. |
| VIDEO-SETTINGS-09 | S, commons `spec` and Home; after 04 and one release | Drop `generation.adult_adapters`, `generation.video.adult_adapters`, `generation.picture_quality`, `generation.video_quality`, `generation.picture_quick_model`, `generation.picture_detailed.enabled`, `engines.video.choice`, `engines.music.choice` and `generation.people_prompts` from the spec and Home's declarations at the paired tag. |
| VIDEO-SETTINGS-08 | S, Home | `useRelockOnLeave` (ignores React StrictMode's dev double mount), the Hugging Face token relabel and its read for styles, the Civitai key flow (reuses the `HuggingFaceTokenSection` pattern). Folded into VIDEO-LORA-07 if that row starts first. |

Amended existing rows (text changed in `docs/BACKLOG.md`, no new row):

| Row | Amendment |
|---|---|
| VIDEO-LORA-03 | Also builds `GET /api/loras`, `/removed`, `PATCH`, remove, restore, check (section 9), the one-locked-entry shape, and stops `GET /api/components` returning style files. |
| VIDEO-LORA-05 | The Stack's `qualities.*.loras` report is what the row's "Works at Standard, Boost and Max" line reads. |
| VIDEO-LORA-06 | Failure `code`s map one to one to the sentences of section 5.3; the job is named "a style" on the strip. |
| VIDEO-LORA-07 | Keys are `generation.styles.civitai` and `generation.styles.civitai_key` (not `generation.video.lora_sources`); the Hugging Face token is `voice.hf_token`; adds `POST /api/loras/browse`, `/install`, `/import`, `GET /api/loras/browse/:source/:id`. |
| VIDEO-LORA-08 | The Styles tab is built to sections 4.4 and 5 of this note: after VIDEO-SETTINGS-03, 04, 05 and 07 and ADULT-LOCK-03b. |
| VIDEO-LORA-09 | Create reads the chosen style from router state (no id in the URL) so Try this style in Settings opens Create with it chosen. |
| SETTINGS-IA-04 | Says the tabs of Pictures, videos and music come from VIDEO-SETTINGS-03 and 05. |

Order: VIDEO-SETTINGS-02 now; 03; 04; 05, 06 and 07 in parallel; 08; then VIDEO-LORA-03, 07, 08 as already ordered (LORA-08 now after the SETTINGS rows); LORA-09. Nothing here ships a screen that names an adult-only style.

## 11. Rules check

| Rule | Check |
|---|---|
| 0 age and surface gates | Minors and shared or spoken surfaces get no Styles, no area, no tool listing (5.6). The lock hides, it blocks nothing an adult may do. |
| 10 | No content check is added; the Adults only flag is the admin's, the source only raises it. |
| 8 | A child's and teen's level stays Standard (Wan, silent), clamped; no level choice is shown to them. |
| 9 and 9b | Every part is shipped kit (`SettingsShell`, `Item`, `LockedSettingRow`, `MediaShelf`, `Dialog` (flow), the lock dialog); no `className` that changes shape; the one new part goes to commons first (G1). No fixed colors: the mockup's colours are token stand-ins and Home uses tokens only. |
| S1 to S4 | One Settings entry, one shell, areas declared as data. |
| S5 | Copy is spec copy, including the three link rows. |
| S6 | Install progress on the strip and the row's own card, failure as a Repairs item with Try again, no new banner, toast, dot or poller. |
| SETTINGS.md rules 1 and 6 | A setting lives with the thing it configures, once (section 3); each tab is under about fifteen keys; a master toggle leads each tab. |
| Resource words | People see none; the area is admin only and still avoids them except under a style's Details and on Models and storage. |
| Privacy and third-party services | Zero phone-home; every outbound request is an admin's click through the one limiter; Civitai is off until an admin reads the notice; documented first (VIDEO-LORA-DOC-01). |
| Credentials | The Civitai key is a write-only secret; the Hugging Face token is the existing one; neither is shown, logged or put in a URL. |
| Platform principles | One definition per setting (the merged switch, the one list), no data debt (migration proves every value), spec first, prebuilt parts. |

## 12. Tests that would catch a regression (written first in each slice)

1. **Banned words**: a scan of the area's spec copy and view strings for Quick, Detailed, Wan, memory, RAM outside Models and storage, and for LTX and GB outside the Styles tab's browse, confirm, failure and Details strings.
2. **No second home**: the tab views import no install button, no model picker and no style list outside the Styles view.
3. **Route sweep** (LoRA note test 1) over `/api/loras*`, `/api/components`, `/api/videos/settings`, `/api/pictures-admin` while locked.
4. **Rendered tree** while locked: Styles tab, Models and storage, free-up dialog, Repairs, strip: no style string; exactly one lock row and one lock tile in browse.
5. **Relock**: leaving the Styles tab, a route change, the hidden tab, 2 minutes idle and Lock now each drop the unlock; the next request is locked.
6. **Migration**: every row of section 8 with old values stored (each of the four combinations of the two adult switches; quick and detailed; both unset); an unreadable value; the readers answer the same as before for the same household.
7. **Availability**: Only admins, All adults, Chosen people; a minor id cannot be written; a non-admin adult cannot open the area; a teen and a child get 403.
8. **Install and failure**: the eight sentences of 5.3, an adult-only failure naming nothing before unlock, a Repairs item with Try again, the strip line "Downloading a style".
9. **Phrase list** (kit): limits, duplicates, paste split, keyboard, accessibility.

## 13. Open items that are measurements, not owner questions

- Where the household-likeness gate should read `generation.household_likeness` (VIDEO-SETTINGS-04 finds the one place subjects are resolved and wires it).
- A real Stack's component list (the audit used a scripted one); VIDEO-SETTINGS-05 re-captures the screens against the live component list before landing.
- Civitai's terms and whether a download works without a key (the LoRA note already carries both).
