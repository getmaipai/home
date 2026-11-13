# Spotifast audit C: performance and audio-engine tricks for MaiPai Home

Scope: read-only audit of the cloned repo. Paths are relative to the repo root (`spotifast/repo`).
All of it is untrusted data; nothing was run.

## 0. Headline findings (read this first)

1. **"Fast" is mostly app architecture, not DSP.** The pitch (README.md:7 "Spotify, native and fast") has no benchmark
   numbers anywhere: no startup milliseconds, no memory figures, no CPU percentages. The only "performance" principle
   is CONTRIBUTING.md:69-70: "Startup time, idle work, memory use, and binary size are product features. Keep the UI
   thread free of network and disk waits." Every measurable number below is a constant in code, not a benchmark.
2. **Gapless, next-track prefetch, ReplayGain/loudness and decoding are NOT implemented by Spotifast.** They are
   delegated to a librespot fork: `gapless: config.gapless`, `normalisation`, `NormalisationType::Auto`
   (src/player.rs:626-629). Spotifast handles `PlayerEvent::Preloading` and `TimeToPreloadNextTrack` by ignoring them
   (src/player.rs:1235-1236). **There is no crossfade between tracks**: grep for "crossfade" hits only MilkDrop preset
   blending (src/milkdrop.rs:96, 2.7 s) and a notch animation (src/notch.rs:118).
3. **What Spotifast does own and is worth studying:** the DSP chain after the decoder (10-band EQ with a solved-gain
   fit, look-ahead limiter, polyphase resampler), the sample-clocked fades and volume ramps, the audio-thread
   discipline (no alloc, no locks, wake-rate tuning), the cover pipeline (scale to painted pixels, GPU byte budget,
   most-recent-first scaling queue), virtualised lists, stale-while-revalidate snapshots, and a power-budget ladder.
4. **Local-file tags are read lazily per track, not indexed.** No library scan or DB exists (see 8).

Translation key: **WA** = translates to browser Web Audio / web UI; **BE** = Home's Bun/Hono/SQLite/ffmpeg backend;
**No** = native-only or not applicable.

---

## 1. Fast start (caching, lazy load, prefetch)

### 1.1 Stale-while-revalidate account snapshots
- src/account_cache.rs:1-6: "A restart shows the last good answer for the verified account at once, while the app
  asks Spotify again behind it." Metadata only (playlist list, Home shelves, Liked Songs: src/backend.rs:2825-2880).
- Format: `{version, account_id, data}` JSON (src/account_cache.rs:10-25). `read` returns `None` for missing, corrupt,
  older-format or other-account file (account_cache.rs:28-32), so a bad cache can never block startup, only slow it.
- Write is atomic (temp then rename, via `fastframe_file::write` in `spawn_blocking`, account_cache.rs:36-43) so a
  crash leaves the previous snapshot readable.
- Cache read runs on a spawned task and posts an `Event::AccountCaches`, never on the UI thread (backend.rs:2833-2855).
- **Translates: WA yes, BE yes.** Home: keep the last library/home/queue JSON in IndexedDB (or the SQLite row served
  with an ETag), paint it on first render, then revalidate; carry a `version` and the household/profile id and drop
  mismatches silently. This is the single largest "feels instant" trick and it is cheap.

### 1.2 No blocking disk or network on the UI thread (rule, enforced)
- AGENTS.md:27-29: disk-waiting writes go through a `fastframe_file::Writer`; "fastframe_file's guard panics in debug
  builds" if called from the UI thread. AGENTS.md:22-25: network/playback work only on the runtime or player engine.
- Same discipline in storage.rs: the Settings "Storage" sizes (art cache, audio cache, one more) are measured on a
  named thread `storage-usage`, only while the Storage section is drawn, refreshed at most every 5 s
  (`REFRESH_AFTER`, src/storage.rs:8; "Disk traversal never happens here, and closing Settings schedules no further
  scans", storage.rs:~42). An invalidate discards an in-flight scan so a stale answer cannot restore old sizes
  (storage.rs:24-28).
- **Translates: WA** (Web Workers for any heavy parse; never `await` IndexedDB inside a render path), **BE** (do
  directory-size and cache-GC scans in a background job, cache the result with a TTL, compute only when the admin page
  is open).

### 1.3 Release build profile
- Cargo.toml:279-283: `lto = "thin"`, `codegen-units = 1`, `strip = true`, `panic = "abort"`; dev deps at opt-level 2
  because "Audio decoding and immediate-mode layout are too slow at opt-level 0" (Cargo.toml:285-289).
- **Translates: BE partially.** Bun has no equivalent knobs; the web equivalent is shipping a small, code-split bundle.
  Native-only otherwise.

### 1.4 Lazy / deferred work
- Local files: librespot reads the folder's tags "on its own player thread when the engine starts, never on the UI
  thread" (src/player.rs:635-637).
- MilkDrop runs in a separate child process with a shared-memory ring because projectM on the UI thread "would freeze
  the interface" (src/milkdrop.rs:10-11); preset folder listing runs on a thread and shows from a later refresh;
  listing result is "fresh" for 30 s (`LISTED_FRESH`, milkdrop.rs:101).
- Optional feature compile gate: `milkdrop` feature (`#[cfg(feature = "milkdrop")]` throughout src/vis.rs).
- **Translates: WA** (dynamic `import()` for the visualiser and EQ UI; do not load analyser code until opened).

### 1.5 Prefetch
- Audio next-track prefetch: **delegated to librespot**, events ignored in Spotifast (src/player.rs:1235-1236).
- Lyrics: not prefetched; fetched when the lyrics view needs them, with a 30-day positive cache and 7-day negative cache
  (src/lyrics.rs:21-24), and a stale answer is served during outages (`previously_found`, lyrics.rs:~165).
- Covers: fetched once and kept on disk (images.rs:1-3); a blurred stand-in from the already-visible thumbnail covers
  the gap (images.rs:864-870, section 6.4 below).
- **Home implication:** next-track prefetch is not something to copy from here; design it ourselves (section 2).

---

## 2. Gapless, crossfade, next-track prefetch

What Spotifast does itself:

- **Gapless is a sink contract, not a decoder trick.** The sink stays running between tracks: "librespot deliberately
  leaves a gapless sink running between tracks" (src/sink.rs:91-99). Natural track change keeps the queued audio;
  explicit skip needs special handling.
- **Explicit skip: fade out then discard.** The old signal is faded on the audio thread over `INTERRUPT_FADE = 50 ms`
  per side (sink.rs:68-69), then the queue is discarded; writes stay gated until the player reports the replacement
  loaded (sink.rs:91-100). Repeated skips share one handoff (sink.rs:147-148). Seeks discard queued audio without gating
  (sink.rs:98-99).
- **Play/Pause/Stop ramps:** `TRANSPORT_FADE = 50 ms` (sink.rs:71-72), cut to fit remaining queued sound so a pause
  never clicks (sink.rs:485, "so Pause can cut its ramp to fit").
- **Volume/mute ramp:** 30 ms linear per-sample (`VOLUME_RAMP`, sink.rs:74-75; `VolumeRamp`, sink.rs:613-636). Ramp
  state survives track changes "so a skip during a fade does not snap the level back" (sink.rs:482-483).
- **Sample-clocked envelope:** fade level is a 2^24 fixed-point fraction advanced per frame (`SCALE`, sink.rs:261-262;
  `step_over`, sink.rs:350-352), applied on rodio's output thread so already-queued audio is smoothed (sink.rs:359-361).
- Position display is interpolated between 1 s reports: `position_now()` = last report + `elapsed`, clamped to track
  length (src/player.rs:~230-240); the engine reports every 1 s (`position_update_interval`, player.rs:630).
- **Crossfade: absent.** The only crossfade-like code is MilkDrop's 2.7 s preset blend.

**Translates to Web Audio: WA yes.**
- Gapless in a browser: schedule the next `AudioBufferSourceNode`/`MediaElementAudioSourceNode` against
  `AudioContext.currentTime` a few seconds before the end, or run two `<audio>` elements A/B. Start next at
  `currentTime + remaining`. Trim encoder padding (LAME/AAC priming) in the file metadata; ffmpeg can pre-trim or
  report `start_skip`/`gapless_info` at ingest (BE).
- 50 ms transport and 30 ms volume ramps: use `gain.setTargetAtTime`/`linearRampToValueAtTime`; never set `gain.value`
  directly (clicks). Cheap, high value. Home likely already needs this for pause/skip pops.
- Position interpolation: derive from `audioContext.currentTime` deltas, not `timeupdate` (250 ms granularity).
- Prefetch: BE can expose the next track URL + `Range`-friendly stream; client `fetch`es next file ahead (or sets
  `preload="auto"` on the standby element) once 80-90% played.

---

## 3. EQ DSP

All in src/eq.rs. Source is Winamp's 10-band EQ.

| Item | Value | Cite |
|---|---|---|
| Bands (Hz) | 60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000 | eq.rs:15-17 |
| Range | +/-12 dB per band and preamp | eq.rs:19, 33-37 |
| Filter | one RBJ-cookbook peaking biquad per band per channel, direct form I, f64 | eq.rs:350-395 (`Biquad::peaking` :372) |
| Bypass | a band within 0.05 dB of flat is dropped from the chain; all-flat = empty chain | eq.rs:21, 130-132 |
| Width (not fixed Q) | each band's width in octaves = half the distance to each neighbour; outer bands 3 oct below 60 Hz and 1 oct above 16 kHz | eq.rs:98-118 (`band_widths` :104) |
| Q handling | width via the cookbook's digital form with a `w0/sin(w0)` term; plain analog Q "would have come out three times too narrow" at the top and "rippled the treble" | eq.rs:366-371 |
| Slider-accurate gains | the **combined** response is solved so it equals each slider at its centre: build a 10x10 interaction matrix (each band's 1 dB effect on every centre), iterate up to 6 times with Gaussian elimination + partial pivoting, stop at residual under 0.01 dB; solved gain limit 36 dB | eq.rs:119-182 (`chain_at_rate` :126, `solve` :184, `SOLVED_LIMIT` :24) |
| Preamp | `10^(dB/20)` linear multiplier | eq.rs:~440 (`rebuild`) |
| Balance, mono | independent of EQ-on; quieter side attenuated, never boosted | eq.rs:55-70 |
| Presets | 18 Winamp presets + extras (Bass Booster/Reducer, Treble Booster, Vocal Booster, Small Speakers, Spoken Word, Loudness, Night Listening, ...) | eq.rs:~232-345 |
| Rebuild | settings behind a mutex, read once per packet, filters rebuilt only if changed | eq.rs:1-8, 470-480 |
| Realtime path | `apply()` has no lock and no allocation; `prepared()` syncs settings off the audio thread | eq.rs:484-491 |
| Curve display | same biquad transfer function evaluated on the unit circle (`gain_db_at`, eq.rs:~393) so the UI curve is what is played | eq.rs:80-92, 393 |

Notes:
- Headroom: EQ does NOT clip; the limiter downstream handles it (eq.rs:6-7).
- Order in chain (src/vis.rs:267-300, `Tapped::write`): EQ, then tap (visualiser), then volume, then limiter.

**Translates: WA yes, partially.** `BiquadFilterNode` type `"peaking"` already exists, one per band, and the browser does the
DSP natively (cheap, off main thread). Tricks worth porting:
1. **Width in octaves from neighbour spacing** instead of a single Q (Web Audio takes Q: convert
   `Q = 1 / (2 * sinh(ln2/2 * width * w0/sin(w0)))`, i.e. the same formula inverted). Prevents treble overboost on
   uneven bands.
2. **Solve gains so the sum hits the sliders** (the matrix fit). Pure JS on 10x10, runs once per slider change; apply
   the solved gains to the nodes. This is the difference between "slider says +6 dB and you get +9 dB".
3. Drop flat bands from the node chain (disconnect) to save CPU.
4. Draw the response curve with `BiquadFilterNode.getFrequencyResponse()` (free in WA; replaces the hand transfer function).
5. **Preamp + limiter** pairing (section 4) matters more than the bands.
BE: not needed; EQ is client-side. If server-side render is ever needed, ffmpeg `equalizer` filters take `width_type=o`.

---

## 4. Limiter and headroom

src/limiter.rs (whole file 256 lines, tests included). Purpose: EQ/preamp boosts past full scale are limited instead of
hard clipped.

| Param | Value | Cite |
|---|---|---|
| Threshold | -1 dBFS | limiter.rs:20 |
| Soft knee | 2 dB wide below threshold, so unity gain until -2 dBFS | limiter.rs:15-22 |
| Knee curve | quadratic: `above^2 / (2*knee)` | limiter.rs:48-57 |
| Attack | 1.5 ms (one-pole) | limiter.rs:24 |
| Release | 100 ms | limiter.rs:25 |
| Look-ahead | 8 ms (353 frames at 44.1 kHz), a delay line so gain is already down when the peak arrives | limiter.rs:27, 71-80 |
| Detection | max of both channels, one shared gain, so the stereo image does not move | limiter.rs:95-120 |
| Smoothing | `1 - exp(-1/(ms*fs))` per sample; attack coefficient if target gain is lower, release otherwise | limiter.rs:31-37, 108-114 |
| Final safety | hard clamp to ceiling for numeric overshoot only | limiter.rs:118 |
| Alignment | -2 dB unity point deliberately matches librespot's normalisation threshold so normalised flat audio is untouched | limiter.rs:15-18 |
| Volume-aware ceiling | limiter sits BEFORE the volume stage, so ceiling = `1/volume` ("at quarter volume, four reaches full scale"), none at volume 0 | limiter.rs:90-95; vis.rs:242-254 |

Tests encode behaviour: below the knee is bit-exact passthrough, a 4x tone settles at -1 dBFS (+/-0.01), look-ahead
keeps first-sample peak under 0.95, stereo ratio preserved, gain recovers slowly, block length preserved
(limiter.rs:150-250).

**Translates: WA yes, but there is no native look-ahead limiter node.**
- `DynamicsCompressorNode` is the built-in: set `threshold=-3`, `knee=2..3`, `ratio=20`, `attack=0.0015..0.003`,
  `release=0.1`. It has a fixed ~6 ms internal look-ahead and is stereo-linked, so it approximates this limiter with
  zero custom code. Put it last in the graph (after EQ and preamp, before `destination`).
- If exact behaviour is wanted: an `AudioWorkletProcessor` implementing this exact algorithm (delay line 8 ms, peak of
  L/R, quadratic knee, 1.5/100 ms one-pole). It is ~60 lines; runs off the main thread; allocate the delay ring once in
  the constructor (the Rust code stresses no allocation on the audio thread, limiter.rs:66-69).
- Volume-aware ceiling: in WA put the master volume `GainNode` AFTER the limiter and set the limiter threshold relative
  to it, or (simpler) place volume BEFORE the limiter and skip the idea.
- BE: ffmpeg `alimiter=limit=0.89:attack=1.5:release=100:level=0` (limit 0.89 = -1 dBFS) does the same for server-side
  normalised exports; `asoftclip` is the cheap alternative.

---

## 5. Resampling

src/resample.rs (266 lines). Only used when the output device is not 44.1 kHz (src/sink.rs:597-600, 832).

- Why: "many shared Windows devices run at 48 kHz. rodio resets its resampler at each chunk boundary, which can cause
  crackle. This converter preserves state across chunks." (resample.rs:3-6)
- Algorithm: rational polyphase windowed-sinc. `up/down = to/from / gcd` (44100 to 48000 is 160/147), kernel precomputed
  per phase (`up` phases x 64 taps), each phase normalised to unit gain so DC passes at exactly 1.0 (resample.rs:148-170).
- **64 taps**, "passband flat to about 19 kHz" (resample.rs:12-14); cutoff `0.475 * min(up/down,1)` of the sample rate
  (resample.rs:150); **Blackman window** `0.42 + 0.5cos(pi x) + 0.08cos(2 pi x)` (resample.rs:158).
- Only computes the taps needed per output sample; keeps just the tail of input between chunks (resample.rs:60-100).
- SIMD-friendly stereo dot product: 8 independent running sums per channel ("LANES = 8") so the compiler vectorises on
  any target; pairwise final add, deterministic; error ~1e-7 (under -130 dB) vs naive order (resample.rs:15-18, 118-146).
- f32 buffers; `reserve`/`reset` exist so the audio thread never allocates (resample.rs:~100-120, Linux).
- Chunk-boundary state is the whole point: tests check 1 kHz tone output length and amplitude after chunked processing.

**Translates: mostly No (Web Audio does this itself).** `AudioContext` resamples decoded audio to the context rate with
the browser's resampler; create the context at `sampleRate: 44100` or leave default. Lessons that DO transfer:
1. Never resample per-chunk in a streaming path without keeping filter state (relevant if Home ever does manual
   `AudioWorklet` streaming or PCM-over-WebSocket).
2. BE/ffmpeg: use `aresample=resampler=soxr:precision=28` (or default swr) for server-side transcode; precompute once
   per track, not per request.

---

## 6. Normalisation / loudness

- **Not implemented in this repo.** `normalisation: config.normalisation`, `NormalisationType::Auto`
  (src/player.rs:628-629); the factor is computed inside the librespot fork and reported back through an
  `Arc<AtomicU64>` (`normalisation_report`, player.rs:631-634). Default is off in tests (player.rs:2031). Spotify
  supplies per-track ReplayGain-style values in its metadata; librespot applies them with its own limiter threshold.
- Spotifast undoes the factor for the visualiser: `restore = 1/factor`, clamped to 0.125..8, only when factor is in
  0.05..20, so bars show source dynamics (src/vis.rs:279-289).
- Volume curve: `VolumeCtrl::Cubic(DEFAULT_DB_RANGE)`; the stock librespot log curve spans 60 dB and "puts half the
  slider below -30 dB and every level anyone wants in its top quarter". Cubic reaches -16 dB at the middle and -7 dB at
  three quarters (src/player.rs:641-648). **Translates: WA yes (strong).** Map slider `s` in 0..1 to gain `s^3`
  (about -18 dB at 0.5, -7.5 dB at 0.75), apply with a 30 ms ramp. Very cheap UX win.

**Home port (BE + WA):** measure loudness at ingest with ffmpeg `loudnorm=print_format=json` (EBU R128, store `I`,
`LRA`, `TP`) or `ebur128`/ReplayGain tags; store `loudness_lufs` and `true_peak` per track in SQLite; client applies
`gain = clamp(target - lufs, ...)` via a `GainNode` before the limiter, with target about -14 LUFS (Spotify default
is -14, matching librespot -2 dBFS limiter point). Keep limiter threshold aligned with that peak ceiling.

---

## 7. Cover/image caching and sizing

src/images.rs (2756 lines). This is the most transferable section.

1. **Fetch once, keep on disk.** Cache file name is SHA-1 of the URL (images.rs:~160-165). Download streams with a size
   cap: `MAX_ART_BYTES = 8 MiB`, refused up front by `Content-Length` and again while streaming chunks (images.rs:31,
   483-499). Write is temp `.part` then `rename`, on `spawn_blocking` (images.rs:500-510).
2. **Scale to the pixels actually painted, off the UI thread.** Covers are decoded and scaled to the displayed size
   (steps of 32 px: `cover_pixels` = `ceil(px/32)*32`, images.rs:60-67), so the GPU holds ~192 px, ~200 KB per card
   instead of a 640 px source (images.rs:20-28). A 300 px source drawn at 60 px "keeps the detail a 64 pixel rendition
   from Spotify loses to its compression" (images.rs:1090-1095).
3. **Scale quality:** Lanczos3 (images.rs:1031-1050), with a pre-shrink: if source > 2x target, `thumbnail()` to 2x first,
   then Lanczos. Never enlarges (images.rs:1023-1037).
4. **GPU memory budget by bytes, not time.** `HELD_BYTES = 64 MiB` (images.rs:30). Time-based eviction failed: visible
   images were evicted and reloaded every 2.5 min (#129, images.rs:20-24). Eviction is LRU by last paint above budget
   (`over_budget`, images.rs:410-430). Texture cost = `w*h*4*4/3` (RGBA plus mipmap chain, images.rs:53-58).
5. **Free the decoded copy once the GPU has it** (`forget_decoded`, images.rs:85-100; `note_texture`, images.rs:297-330).
6. **Superseded copies:** after a resize leaves copies at 32-px steps, older ones are dropped 5 s after the artwork's last
   paint (`SUPERSEDED`, images.rs:38; `superseded`, :379-405).
7. **Bounded, recency-first work queue:** `SCALING_AT_ONCE = 2` cores; waiting copies are chosen most-recently-asked
   first; a request not re-asked within `SCALING_STALE = 500 ms` is **dropped** ("A cover scrolled past before its turn
   came is not made at all") (images.rs:1065-1075, 1114-1150). This is what keeps fast scrolls smooth.
8. **Mipmapped linear sampling** (`COVER_TEXTURE`, images.rs:47-48) to avoid stair-stepping when a larger copy stands in.
9. **Stand-in while loading:** a blurred enlargement of the already-visible library thumbnail (`COVER_BLUR = 1.5`,
   `LYRICS_BLUR = 9.0`, images.rs:776-785) computed off-thread and cached (`HELD_COVERS = 64`, images.rs:786), so reopening
   shows something instantly.
10. **Palette:** `art_palette` thumbnails to 48x48, picks up to 4 colours, each >=6% share, >= 1/12 turn apart in hue
    (images.rs:667-745); used to tint the UI.
11. Local covers are read fresh from tags each time (so changes show) and copied into the same disk cache
    (images.rs:515-545); a `coverless` set avoids re-reading files with no art (images.rs:~175).
12. HTTP: one shared client behind `Arc<RwLock>` so a proxy change takes effect without restart (src/http.rs:8-50);
    timeouts 30 s (bulk) and 20 s (blocking); `retry::never()` on the playback client (http.rs:67-78). No explicit
    connection-pool tuning, no custom HTTP/2 settings in this file.

**Translates: WA yes, BE yes, strongest area.**
- **BE:** on cover ingest (or first request) generate fixed-size WebP/AVIF variants with ffmpeg or sharp at 64/128/192/
  256/512 (the 32-step idea becomes fixed breakpoints), store in SQLite-referenced files named by content hash, serve
  with `Cache-Control: public, max-age=31536000, immutable`. Add `ETag`. Resize with Lanczos (`ffmpeg -vf scale=...:flags=lanczos`)
  and pre-shrink for big sources.
- **WA:** `<img srcset sizes loading="lazy" decoding="async" fetchpriority>`; keep image decoded via `decode()`; use
  `IntersectionObserver` to cancel offscreen requests (equivalent of the 500 ms stale-drop); CSS blurred 16 px
  thumbnail as `background-image` placeholder (BlurHash/ThumbHash string stored in SQLite, ~30 bytes, equals the palette
  stand-in idea); extract palette once server-side (4 colours) and store in the record.
- A byte-budget cache has no direct browser analogue (the browser manages decoded images), but cap in-memory
  `ImageBitmap`/Object-URL caches by bytes and revoke Object URLs for off-screen items.

---

## 8. List virtualisation and scrolling

- **Row virtualisation:** `virtual_rows` lays out only rows that intersect the clip rect, fixed `row_height`, spacer
  `allocate_space` before and after (src/ui/widgets.rs:345-380). Keeps one neighbour row on each side "so Tab can focus
  it and scroll it in" (widgets.rs:361-364). Requires equal row heights.
- **Card grid:** `virtual_wrapped_cards` computes `cards_per_row = floor((width+gap)/(CARD_WIDTH+gap))` and virtualises
  by row (widgets.rs:384-415).
- **Infinite pagination:** `load_more_when_near_end` asks for the next page when scrolled near the end (widgets.rs:418+).
- **Sorting cost:** library order builds a rank map **once per frame** instead of `position()` inside the sort
  comparator, which made scrolling quadratic (src/ui/sidebar.rs:424-433; docs/_guide/make-it-even-faster.md:6-12).
  Drag-and-drop slot detection relies on fixed row height because rows are virtualised (src/ui/collection.rs:876).
- **Large API fetches:** page sizes 1000 for playlist items (`PAGE`, src/session_reads.rs:637), 500 root list
  (:843), 50 play-count page and 1000 max rows (:380-382); owner-name lookups limited to 4 at once with 5 s wait and
  max 100 (`OWNER_NAMES_*`, :890-893); name reads 6 at a time via `Semaphore` (:1190-1212); **batched** entity requests
  for track/episode details in one call (:1700-1730).
- **Redraw policy:** the main window "draws as needed and uses the platform's frame pacing"
  (docs/_guide/make-it-even-faster.md:14-18); animations use `request_repaint_after`.

**Translates: WA yes.** Use `@tanstack/virtual` or `react-virtuoso` (fixed-height rows keep it simple; same trade-off).
Overscan of 1 row plus focus-retention. Precompute sort ranks in a `Map` once per sort, not in the comparator.
BE: cursor pagination in Hono (`WHERE (sort_key, id) > (?, ?) LIMIT 500`), index every sortable column in SQLite, and batch
detail lookups with one `IN (...)` query instead of N queries. `content-visibility: auto` + `contain-intrinsic-size` is a
cheap CSS-only partial win.

---

## 9. Local file tags and library indexing

src/local_tags.rs (289 lines):
- Uses `symphonia` probe (src/local_tags.rs:13-17, 44-60) to read only the metadata: front-cover picture (APIC /
  FLAC PICTURE, preferring `FrontCover` usage, local_tags.rs:67-77) and lyrics (USLT, Vorbis `LYRICS`; `.lrc` sidecar
  first; BOM stripped; local_tags.rs:96-125).
- **No index, no scan, no database.** A local file is only known through a Spotify playlist entry
  (artist/album/title/length, local_tags.rs:3-5); the folder is chosen by the user and the matching happens by
  playlist URIs (src/app.rs:2939-2945, 12040-12100). Tags are read on demand "off the UI thread" (local_tags.rs:8-9,
  images.rs:522; backend.rs:4776 `spawn_blocking`).
- Tag-reading restoration quirk: ISO-8859-1 tags lose line breaks, so single-line LRC is re-split before each `[mm:ss`
  stamp (local_tags.rs:~123-145).
- Sample rate "any" supported thanks to the resampler (README.md:75).

**Translates: BE yes (this is where Home must do better than Spotifast).** Home needs a real index:
1. SQLite table `tracks` (path, size, mtime, content hash, tags, duration, loudness, cover_hash). Scan by walking the
   tree, **skip files whose size+mtime match** the row (incremental), parse tags with `ffprobe -show_format -show_streams
   -of json` or `music-metadata` in Bun, extract cover with `ffmpeg -an -vcodec copy`.
2. Do the scan in a background job with a concurrency limit (2-4), resumable, with a progress row for the status UI.
3. Use FTS5 for search.
4. Spotifast's "read cover/lyrics lazily, off the request path, cache by hash" matches the Home approach.

---

## 10. Lyrics sync and auto-scroll

- **Source order:** Spotify lyrics when the session is signed in, LRCLIB fallback (README.md:76). LRCLIB:
  `/get` exact (artist, track, album, duration) then `/search`; candidates are scored: artist match +1000, duration
  drift gives `(30 - drift)*10` and **>30 s drift is rejected** (`MAX_DRIFT_SECS`, src/lyrics.rs:27, 380-400), synced
  upload +200 on a tie. Title/artist cleaning strips bracket and suffix noise ("Remastered", etc., lyrics.rs:423-470).
- **Retries/limits:** LRCLIB ~1 req/s: up to 3 retries on 429, 1 on service errors, honour `Retry-After` up to 5 s,
  5 s request timeout, 20 s lookup timeout (lyrics.rs:28-36). Disk cache: 30 d positive, 7 d negative, stale served on
  outage (lyrics.rs:21-24).
- **LRC parser:** `[mm:ss.xx]` (also `:` fraction, 1-3 digits scaled to ms), multiple stamps per line, stable sort by
  `at_ms` (lyrics.rs:681-725).
- **Active line:** `partition_point` (binary search) over `at_ms <= position_ms`, minus 1 -> O(log n) per frame
  (src/lyrics.rs:64-75). Position comes from the interpolated `position_now()` (section 2).
- **Highlight:** line lights up with 220 ms ease (`LIGHT_UP_SECONDS = 0.22`, src/ui/lyrics.rs:32) via per-line
  `animate_bool_with_time`; active line bold and accent-colour, the rest at 45% opacity (ui/lyrics.rs:210-240).
- **Auto-scroll:** follow mode scrolls the active line to **20% from the top** (`SUNG_LINE_AT = 0.2`,
  ui/lyrics.rs:16-28) with scroll animation; only re-targets when the active index changes
  (`follow = lyrics_following && lyrics_line_shown != Some(active)`, ui/lyrics.rs:209-210); before the first line it
  scrolls to the top (:221-232).
- **Unsynced lyrics:** scroll proportionally to `position/duration` (ui/lyrics.rs:288-300).
- **Manual scroll pauses following** (wheel or drag), clicking a line seeks to its `at_ms` and resumes following
  (ui/lyrics.rs:270-280, 868-873; app.rs:693-695 `lyrics_following`). Padding of 80% viewport below the last line so it
  can reach the 20% mark (ui/lyrics.rs:303).
- **Middle-click autoscroll** (src/autoscroll/active.rs, Windows/Linux only; macOS stub): Chromium's formula,
  `speed = distance^2.2 * 0.000008 * 5000` per second, dead zone 15 px, max step 0.1 s so a stalled frame cannot jump
  (active.rs:11-18). Marginal for a web app (browsers have it natively).

**Translates: WA yes, BE yes.**
- BE: cache lyrics in SQLite (`track_id`, `synced`, `lrc`, `fetched_at`, `negative`), 30 d / 7 d TTLs; reuse the
  scoring rules; serve pre-parsed `[ [ms, text], ... ]` JSON.
- WA: binary search on ms; drive from `audioContext.currentTime` or `audio.currentTime` via `requestAnimationFrame`,
  update only on index change; `element.scrollIntoView` with a manual offset to the 20% mark, or
  `scrollTo({top, behavior: 'smooth'})`; set a `userScrolled` flag on `wheel`/`touchmove`/`pointerdown` (NOT on scroll
  events your own scroll triggers) and reset on line click; 220 ms CSS transition on colour/weight.
- Latency compensation: add output latency (`audioContext.outputLatency + baseLatency`) to lyric time. Spotifast does
  an analogous thing for visuals (`LAG` below).

---

## 11. Visualiser frame pipeline

**Audio tap (src/vis.rs):**
- Tap keeps **0.5 s** of post-EQ, pre-volume, pre-normalisation audio (`KEPT = SAMPLE_RATE/2`, vis.rs:19-20, 52-58).
- Reads **200 ms behind** the newest sample (`LAG = SAMPLE_RATE/5`, vis.rs:21-24): "what the speaker is playing rather
  than what the sink has queued" (sink queue is 180-200 ms, `QUEUE_AHEAD = 200 ms`, sink.rs:49-53).
- Spectrum: Winamp-compatible, **512-sample Hann FFT -> 256 magnitudes**, hand-written radix-2 (precomputed bit-reverse,
  twiddles, window; vis.rs:306-392), `SPEC_SCALE = 0.5`, `CHANNEL_SUM = 2.0` (vis.rs:47-50). Winamp-style band mapping:
  semitone warp `2^(x/12)` over 75 columns with Hermite interpolation (vis.rs:514-563). Player-bar analyser uses
  75 bands (`WIDE_BANDS`, vis.rs:596).
- **Fixed physics clock, not frame-rate dependent:** bars move on a **16.667 ms** step (`STEP`, vis.rs:40-44); a frame
  catches up at most 2 steps (`CATCH_UP`, vis.rs:46, 446); fall `12/16` rows per step (`FALLOFF`, vis.rs:38); wide
  analyser fall in heights per second (`WIDE_FALL`, vis.rs:597-599); peak hold 0.35 s then gravity 2.4/s^2
  (`PEAK_HOLD`, `PEAK_GRAVITY`, vis.rs:600-603).
- Scope: every 7th of 576 samples, no smoothing (vis.rs:28, 709-710).
- Tap uses a `Mutex<VecDeque<f32>>` capped at `KEPT`, mono mix pushed per packet (vis.rs:56-58, 176).

**MilkDrop (src/milkdrop*, libprojectM):**
- Separate **child process** (`--milkdrop-child`) because winit allows one event loop per process (milkdrop.rs:1-11).
- Audio ring to the child: memory-mapped file, one producer/one consumer, `u64` atomic frame counter + stereo f32
  frames, **22,050 frames** (0.5 s), torn frames accepted (src/milkdrop/shm.rs:1-35).
- Video frames back to the app (skin pane): 3-slot **sequence-lock** ring in shared memory: writer writes the slot
  after the last published, reader copies the newest and discards a copy if the sequence changed; "Neither side ever
  waits"; header carries requests as atomics so the UI thread never writes to a pipe (src/milkdrop/frames.rs:1-14).
  Frame size capped: **1280 px** longest side for panes, **1920** for full-screen lyrics (`PANE_SIDE`,
  `FULL_SCREEN_SIDE`, frames.rs:20-27), "every frame crosses the process boundary and the graphics card twice".
  Sparse file: only touched pages use memory (frames.rs:28-35).
- Defaults: 60 fps, configurable **10..=360**, 0 = uncapped (milkdrop.rs:45-48); preset every 10 s
  (`DEFAULT_SECONDS`, :44); preset crossfade 2.7 s (:96); window default 640x480, min 320x240 (:91-94).

**Translates: WA yes, strong.**
- `AnalyserNode` with `fftSize = 512..2048`, `smoothingTimeConstant ~0.8`, `getByteFrequencyData` into one reused
  `Uint8Array`. Draw in `requestAnimationFrame`, but advance bar physics on a fixed 60 Hz accumulator (the STEP/CATCH_UP
  idea) so bars fall the same at 30, 60, 144 Hz.
- **Delay the analyser tap** by output latency (~100-200 ms with a `DelayNode` before the analyser; or compute
  `outputLatency` and offset) so visuals match what is heard; Spotifast measured 200 ms.
- Run the analyser on a branch off the EQ output (post-EQ, pre-master volume) so the volume slider does not move the
  bars; divide out loudness-normalisation gain as Spotifast does.
- Heavy visualiser (WebGL/butterchurn = MilkDrop in JS): use `OffscreenCanvas` in a Worker, cap the long side at
  1280, cap fps, and pause when hidden (section 12).
- SharedArrayBuffer/ring tricks are not needed; `AudioWorklet` can post chunks to a Worker through a
  `SharedArrayBuffer` ring only if COOP/COEP is enabled (Home may not want that cost).

---

## 12. Memory, CPU, power

**Audio thread discipline (src/sink.rs):**
- Queue ahead **200 ms** measured in time, not chunks ("librespot's packets hold as little as 4 ms ... could be less
  than one PipeWire quantum (2048 frames, 43 ms)", sink.rs:49-53).
- `REFILL = 20 ms`: writer wakes when 20 ms have played, about 30 wake-ups/s instead of ~100 (sink.rs:55-59).
- `QUEUE_WAIT = 50 ms` safety poll; `DRAIN_TIMEOUT = 2 s` on stop (sink.rs:61-66).
- Default device buffer 100 ms, allowed 20..500 ms: smaller clicks under load (#88) (sink.rs:81-89).
- Paused player costs **zero audio work**: the stream pauses with playback (#636, sink.rs:9-10); device released after a long
  pause and reopened on demand (sink.rs:548-551). Underrun logging rate-limited to once per 10 s (sink.rs:77-79).
- No allocation on the audio thread: `Limiter` queue sized `lookahead+1` up front (limiter.rs:66-69), resampler `reserve`
  and `reset` APIs (resample.rs:~100-125), EQ `apply` lock-free.
- f64 DSP internally (EQ, limiter), f32 resampler.

**Memory budgets:** GPU art 64 MiB (images.rs:30); single image 8 MiB (:31); tap 0.5 s (22,050 stereo frames = 176 KB
shm, 22,050 f32 mono = 88 KB); MilkDrop frame slots 3 x (1920^2 x 4 B = 14.7 MB) sparse (frames.rs:28-32); history caps at
500 plays (src/history.rs:~20); audio cache default **1024 MB**, minimum 64 MB (src/settings.rs:502; src/app.rs:15331);
softened covers 64 (images.rs:786); SHA-1 file names.

**Play history counts only real listens:** `min(30 s, duration/2)`, min 1 s (src/history.rs:15-25); dedupe window 60 s
vs the server's report (history.rs:27-31). **Translates: BE** (one `plays` table; "counted" flag after threshold).

**Power budget ladder (src/power.rs):**
- `Budget::{Normal, Saver, Background}` (power.rs:16-27): Background when no window, display off or session locked
  (nothing drawn, polling slows); Saver when energy saver on or window unfocused (animations at half rate)
  (power.rs:30-37).
- MilkDrop fps: unlimited/60 normally, **<=30** while saving, **1 fps** when display off or locked (power.rs:46-54).
- Main-window visualisers: chosen fps in focus, **half** out of focus (uncapped halves to 30), **<=30** saving, **none** when
  nobody can see it (power.rs:58-71).
- Keep-awake only while local playback is playing/loading; paused/stopped lets the OS nap and sleep (power.rs:75-82).
- **Translates: WA yes, strong, near-free.** Use `document.visibilityState`/`visibilitychange` (stop rAF when hidden;
  rAF already throttles but Web Audio keeps running, so you must stop the analyser loop yourself), `window` blur ->
  halve fps, `matchMedia('(prefers-reduced-motion)')` and the Battery API where available -> Saver; `Wake Lock API`
  only during playback; `IntersectionObserver` to pause canvases off-screen. Suspend the `AudioContext`
  (`ctx.suspend()`) a few seconds after pause so the audio thread sleeps; resume on play (this is the "paused costs
  nothing" trick).

---

## 13. Measurable numbers collected (all constants, no benchmarks)

| What | Number | Cite |
|---|---|---|
| Output queue ahead | 200 ms | sink.rs:53 |
| Writer refill wake | 20 ms (~30 Hz) | sink.rs:59 |
| Device buffer default / range | 100 ms / 20-500 ms | sink.rs:85-89 |
| Interrupt fade (each side) | 50 ms | sink.rs:69 |
| Play/Pause ramp | 50 ms | sink.rs:72 |
| Volume/mute ramp | 30 ms | sink.rs:75 |
| Limiter: threshold, knee, attack, release, look-ahead | -1 dBFS, 2 dB, 1.5 ms, 100 ms, 8 ms | limiter.rs:20-27 |
| EQ: bands, range | 10, +/-12 dB | eq.rs:15-19 |
| EQ flat-skip | 0.05 dB; solver 6 passes, 0.01 dB residual, 36 dB limit | eq.rs:21, 24, 142-155 |
| Resampler taps / cutoff / window | 64 / 0.475 fs / Blackman, passband ~19 kHz, error under -130 dB | resample.rs:14, 150, 158 |
| Tap buffer / lag | 0.5 s / 200 ms | vis.rs:20, 24 |
| FFT | 512 samples, 256 bins, Hann | vis.rs:26, 306-308 |
| Analyser step / catch-up | 16.667 ms / 2 steps | vis.rs:44-46 |
| MilkDrop fps | default 60, range 10-360, 30 on saver, 1 locked | milkdrop.rs:46-48; power.rs:46-54 |
| Pane frame cap | 1280 px (1920 full screen), 3 slots | frames.rs:20-27 |
| Art GPU budget / max file | 64 MiB / 8 MiB | images.rs:30-31 |
| Cover step / scaling threads / stale drop | 32 px / 2 / 500 ms | images.rs:62-67, 1065-1075 |
| Cover superseded delay | 5 s | images.rs:38 |
| Lyrics line light-up | 220 ms | ui/lyrics.rs:32 |
| Lyrics follow position | 20% from top | ui/lyrics.rs:16 |
| Lyrics cache TTL | 30 d / 7 d negative | lyrics.rs:21-24 |
| LRCLIB duration drift reject | 30 s | lyrics.rs:27 |
| History threshold | min(30 s, half track) | history.rs:15-25 |
| Storage size scan refresh | 5 s | storage.rs:8 |
| Audio cache default | 1024 MB | settings.rs:502 |
| Position report interval | 1 s | player.rs:630 |
| Win HTTP timeouts | 30 s / 20 s | http.rs:67-78 |

---

## 14. Port priority for MaiPai Home (my read)

High value, low cost (do first):
1. **Stale-while-revalidate snapshots** (1.1) for library/home/queue in IndexedDB + server ETag.
2. **Gain ramps** 30 ms volume, 50 ms transport (2) and cubic volume curve (6).
3. **Pause = `ctx.suspend()` and stop rAF when hidden** (12): measurable battery/CPU cut on the hub's kiosk/tablet clients.
4. **Last-in-chain limiter** (4): `DynamicsCompressorNode` now, AudioWorklet later; prevents EQ clipping.
5. **Cover variants + immutable cache headers + blurhash placeholder** (7) via ffmpeg/sharp on the BE.
6. **Virtualised lists with fixed row heights; sort ranks computed once** (8).
7. **Lyrics: binary search, 20% follow line, user-scroll pause, 220 ms transition, TTL cache** (10).

Medium:
8. EQ: octave-width bands + solved gains, `getFrequencyResponse` for the curve (3).
9. Loudness at ingest via ffmpeg `loudnorm`/`ebur128`, per-track gain in SQLite (6).
10. Visualiser: fixed 60 Hz physics clock, output-latency-delayed tap, fps ladder (11, 12).
11. Gapless: A/B elements or scheduled sources with trimmed padding (2).

Not worth porting: resampler (WA does it), shared-memory rings and child-process visualiser, middle-click autoscroll,
Cargo release profile, GPU byte budgeting (browser owns decoded image memory), librespot normalisation internals.

Caveat for the reader: Spotifast's DSP is correct-looking and well-tested, but its "speed" claims are architectural
(non-blocking UI, caching, small memory) rather than measured; do not cite it as a benchmark source.
