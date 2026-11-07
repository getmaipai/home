# Weather scene v2: a living sky for WeatherCard and WeatherSky (2026-11-06)

Owner direction (2026-11-06): "review [ha-ani-weather-card] and use it to drastically improve our animated weather cards;
use Fable if it is a better animator." The spec below is Fable's design, written from two read-only scouts' evidence
(our current card, and the reference card). Reuse check: the kit's `WeatherCard`, `WeatherSky`, `MoonDisc`,
`weather-condition.ts` (28 WMO codes to 8 classes), the `--weather-*` tokens in `ui/src/tokens.css`, the `fixedColors`
lint and `weather-contrast.test.ts`, and the weather package's data route in Home. No new Element, no new package.

Reference: [alexsto1an/ha-ani-weather-card](https://github.com/alexsto1an/ha-ani-weather-card) (MIT, TypeScript, DOM +
CSS + GSAP). We take ideas only (OKLCH phase palettes mixed in Oklab, parallax cloud layers, a recycled particle pool,
depth by size, rain splashes, snow pendulum sway and a pile, lightning as light with random gaps, a sun that is a light
source, grain and vignette, pause off screen, a static reduced-motion sky). We copy no code and bundle no GSAP.

Files named below live in `commons/ui/src/elements/` unless stated. All numbers are the design; the implementation is web.
Principle 7: every number (phase thresholds, L caps, depth table, counts, budgets, the intensity map, lightning timing) lives in one JSON file,
`commons/ui/src/elements/weather-scene.json`, which `weather-scene.ts` imports and the Go client can read later; TypeScript holds only the
functions. Colours are never in that file (next paragraph).

## 1. Technology: DOM, CSS keyframes and registered custom properties. No canvas, no GSAP.

Every moving thing is a DOM element animated by CSS keyframes on `transform` and `opacity` only. Every colour that changes
is a registered `@property` (`syntax: "<color>"`) with a CSS `transition`. The only JavaScript that runs over time is a 60 s
phase ticker, one `setTimeout` chain for lightning, and `animationiteration` handlers that retime clouds when the wind
changes. Why: transform and opacity keyframes run on the compositor thread (a rAF loop wakes the main thread 60 times a
second), pause off screen with one attribute, give a complete still frame with one media rule, are testable in happy-dom
(element counts, `data-*`, computed custom properties), and the "transform and opacity only" rule is enforceable by a lint
over the `wx-*` keyframes. Particles stay DOM at bounded pools (rain max 28, snow 30, stars 54). The one non-DOM piece:
film grain is a static SVG `feTurbulence` data URI used as a background (drawn once, never animated).

## 2. Sky and time of day

**Colours are tokens (owner rules NO-FIXED-COLORS-01 and the 2026-10-16 weather call "animation is modern CSS plus tokens, gradients from tokens").**
Every authored colour below (the day stops and glows, the night, dusk and dawn target colours, the cloud lit and shade tints) is a `--weather-*`
token defined in all three blocks of `ui/src/tokens.css` (light root, system dark, `.dark`; the two dark blocks hold the same values). The light block holds
the authored values below; each dark block holds its own deeper values for the same tokens, keeping today's light-to-dark offset per class (today every
`--weather-{cls}-{day|night}-{from|to}` token already differs between the light root and the dark blocks, for example clear day from `#1a5fb4` in light and
`#154d93` in dark), so the 2026-10-16 owner call "gradients from tokens (light and dark)" is kept, not superseded. The contrast proof parses all three blocks.
The OKLCH triples in this note are the
VALUES of those tokens, written once in `tokens.css`, never in TypeScript. Phase blending is CSS: `color-mix(in oklab, var(--weather-a),
var(--weather-b) calc(var(--wx-t) * 100%))` with a registered `<number>` property `--wx-t` set from the elevation (the numbers `t`, `strength`
and the caps come from `weather-scene.json`; the L caps are applied with relative colour syntax). JS computes only `--wx-t`, `--wx-light-x/y`,
`--d` and `data-*`, and never a colour.

Props (all optional): `elevation` (degrees), else `sunrise` and `sunset` (ISO local, the shape of `hourly[].time`) plus `now`
(defaults to the client clock, re-read every 60 s), else `isDay`. From times: `m` = signed minutes to the nearest sunrise or
sunset (above the horizon positive); `elevation = clamp(m * 0.2, -12, 12)`; day fraction `f = (now - sunrise) / (sunset -
sunrise)`. From `isDay` alone: elevation +30 or -30 and `f` = 0.5. Phases: `night` below -6, `twilight` -6 to +4 (`dawn` on the
morning side, otherwise `dusk`), `day` above +4; `data-phase` carries the name. Colours are continuous: `t = smoothstep((elevation
+ 6) / 10)`; palette = `mixOklab(night, twilight, t * 2)` for `t < 0.5`, `mixOklab(twilight, day, (t - 0.5) * 2)` above. Mixing is in
Oklab (rectangular), never around the hue wheel.

Authored day palette (OKLCH `[L, C, H]`), stops at 0%, 55%, 100% of the hero height:

| class | top | mid | bottom | glow (L C H, alpha) | overcast |
|---|---|---|---|---|---|
| clear | .42 .140 258 | .47 .130 252 | .50 .110 240 | .86 .080 220, .40 | 0 |
| partly-cloudy | .42 .100 256 | .47 .090 250 | .50 .080 242 | .86 .070 222, .32 | .3 |
| overcast | .40 .025 250 | .44 .024 248 | .49 .022 244 | .84 .014 250, .22 | .85 |
| fog | .42 .012 214 | .46 .012 216 | .50 .012 220 | .86 .010 212, .26 | .9 |
| drizzle | .39 .034 246 | .44 .032 243 | .49 .030 238 | .82 .020 246, .18 | .85 |
| rain | .34 .034 248 | .39 .034 244 | .44 .032 240 | .78 .020 246, .14 | .9 |
| snow | .42 .040 238 | .46 .036 234 | .50 .030 228 | .92 .020 230, .28 | .7 |
| thunderstorm | .25 .036 282 | .30 .038 274 | .35 .036 264 | .70 .030 282, .12 | 1 |

Derived palettes, with `strength = 1 - 0.7 * overcast`. Night: `L' = 0.14 + (L - 0.14) * 0.42`, `C' = C * lerp(0.75, 0.5,
overcast)`, hue pulled 45% toward 264; glow `[.86 .030 250]`, alpha `lerp(.14, .06, overcast)`. Dusk: top mixed `0.5 * strength` toward
`[L*.80, .075, 292]`, mid `0.42 * strength` toward `[L*.88, .065, 350]`, bottom `0.72 * strength` toward `[L*.92, .115, 52]`; glow toward
`[.82 .13 58]` by `strength`. Dawn: top `0.4 * strength` toward `[L*.95, C*.85, 262]`, mid `0.3 * strength` toward `[L*.95, .05, 330]`,
bottom `0.62 * strength` toward `[L*.95, .085, 32]`; glow toward `[.88 .09 40]`. Hard caps after derivation: `L <= 0.46` top, `L <= 0.50`
mid and bottom; chroma gamut-clamped by bisection.

Layers (z-order inside `[data-slot=weather-sky]`): 0 base gradient (`--wx-top`, `--wx-mid` at 55%, `--wx-bottom`); 1 glow
`radial-gradient(46% 70% at var(--wx-light-x) var(--wx-light-y), --wx-glow, transparent 64%)`; 2 vignette; 3 grain (feTurbulence
baseFrequency .9, 2 octaves, 160 px tile, `mix-blend-mode: overlay`, opacity .06; omitted on `lite`); 4 the existing flat
`--weather-scrim` (.16); 5 a text scrim `linear-gradient(to top, --wx-scrim 0%, transparent 60%)` where `--wx-scrim` is the sky's own
hue at L .16 and alpha `lerp(.46, .28, overcast)`.

Contrast guarantee: construction (the L caps, glow alpha <= .40, the light source never below y 40% or left of x 60% on full and
wide) plus proof: `weather-contrast.test.ts` is rewritten to call `skyPalette(cls, phase)` and `sampleSceneAt(x, y)` for 8 classes x 4
phases x 3 token themes at 12 points, composing stop, glow, the test's 22% white worst-case effect, the base scrim and the
gradient scrim, asserting white ink >= 4.5:1. Every `--wx-*` colour is `@property` registered and transitions `3200ms
cubic-bezier(.37, 0, .63, 1)`; first paint sets them inline before `data-mounted="true"` enables the transition.

## 3. Sun, moon, stars

Position (percent of the hero): sun `x = 88 - 28 * f`, `y = 40 - 30 * sin(pi * f)`; the moon uses the same arc on the night
fraction; compact: `x = 86`, `y = 50 - 24 * sin(pi f)`. Set as `--wx-light-x/y`, moved by the 60 s re-render with a 3200 ms transition.
Sun (day and twilight, clear and partly-cloudy; opacity .35 in fog; hidden otherwise): disc 40 px (the two core literals
`#ffd75e` and `#ffb02e` stay in the token), halo A 96 px at .55, halo B 220 px at .30, a 150 px conic corona (12 spokes, `--weather-sun-ray`,
opacity .22) rotating 90 s (full and wide only). Breathing: disc `scale(1 to 1.04)` 9 s alternate; corona `scale(.96 to 1.08)` and
`opacity(.45 to .65)` 7 s alternate; all with `cubic-bezier(.37, 0, .63, 1)`. At twilight the disc tints toward `--wx-glow`. Moon (night,
clear and partly-cloudy; overcast and snow show only the halo at .25): `MoonDisc` at 54 px (full), 40 (compact), 64 (wide), 28 (lite),
halo 150 px, breathing `opacity .85 to 1` 6 s; the `drop-shadow` keyframe `moon-glow-pulse` is removed (it animates `filter`) and the glow is a sibling
element. Stars (night only): clear 54, partly-cloudy 30, overcast 8 (opacity .25, top 20% only), lite 18, none in rain, snow, fog,
storm; 1.5 to 3.5 px, top 0 to 70%; one third twinkle (`opacity 1 to .65`, 3 to 7 s, negative random delay); the field fades in as one over 1.2 s.

## 4. Clouds

No `filter: blur`. One `<span data-fx="cloud" data-shape="a|b|c" data-depth="far|mid|near">` whose `background` is a tint ramp
(`--wx-cloud-shade` at the bottom, `--wx-cloud-lit` above) and whose `mask-image` is a stack of soft radial gradients that carves the
silhouette with naturally soft edges. Three silhouettes, puffs as `(x%, y%, R1%)` (`R2 = R1 + 9%` of width): A stratus 2.6:1:
(18,62,16) (34,50,22) (52,44,24) (70,52,20) (86,64,14) (44,72,20) (62,74,18); B cumulus 1.9:1: (22,66,18) (38,46,24) (56,38,26) (72,52,22)
(84,68,16) (48,74,22) (30,80,16); C puff 1.5:1: (30,60,20) (50,42,28) (70,58,22) (44,78,20) (62,80,18).

Depth: far scale .62, opacity .34, 7 px/s, y 0 to 22%, z 21; mid .88, .56, 13 px/s, y 8 to 40%, z 22; near 1.15, .72, 22 px/s, y 20
to 56%, z 23; widths 160, 220, 300 px before scale. The sky is `container-type: size`; drift runs `translate3d(-100%, 0, 0)` to
`translate3d(100cqw, 0, 0)` so a cloud always enters and leaves fully off the card; duration `(cardWidth + cloudWidth) / (speed *
wind)` in `--d`, set by JS from the measured width; delays `-(i / n) * d` so frame one is populated. Counts (full; lite shows 2; wide +1
far): clear day 2, clear night 0, partly-cloudy 4, overcast 6, drizzle 4, rain 5, snow 3, thunderstorm 6, fog 0.

Tints `--wx-cloud-lit` / `--wx-cloud-shade` (OKLCH, day): clear .98 .005 240 / .86 .020 240; partly-cloudy .97 .006 240 / .80 .025 245;
overcast .78 .012 250 / .58 .015 252; drizzle .74 .015 248 / .55 .020 250; rain .66 .018 250 / .46 .022 252; snow .90 .008 235 / .72 .012 235;
thunderstorm .52 .040 285 / .30 .050 282. Night: L x .55 (lit) and x .6 (shade), hue 45% toward 262. Twilight: lit 35% toward `[.85 .10 60]`,
shade 30% toward `[.45 .07 350]`; both transition with the sky. Wind: `wind` in km/h, `factor = clamp(0.6 + wind / 30, 0.6, 2.4)`; a
change applies at each cloud's next `animationiteration` (new `--d`), never mid-flight. Fog, snow drift use the same factor; rain falls vertically.

## 5. Weather

Intensity comes from the WMO code (`weatherIntensityOf(code)`, new in `weather-condition.ts`): drizzle 51/56 .4, 53 .7, 55/57 1; rain 61/66/80 .45,
63/81 .75, 65/67/82 1; snow 71/85 .4, 73 .7, 75/77/86 1; thunderstorm 95 .8, 96/99 1; others 0. The `intensity` prop overrides it. Counts scale
by `intensity` and by `s = clamp(sqrt(area / (420 * 230)), .6, 2.2)`.

- Drizzle: 16 drops at intensity 1, 1 px wide, 6 to 9 px long, opacity .30 to .50, 180 to 260 px/s, no splashes, plus one fog band at opacity .10
  breathing 7 s. Rain light (< .6): 12 drops, 300 to 380 px/s, 16 to 22 px. Rain (.6 to .9): 18 drops, 380 to 500 px/s, 20 to 30 px, width 1 to 2 px. Heavy
  (>= .9 and thunderstorm): 28 drops, 520 to 700 px/s, 30 to 44 px, width 1.4 to 2.4 px, `rotate(-8deg)`. Opacity `.5 + .45 * (w - 1) / 1.4`. Fall:
  `translate3d(0, -48px, 0)` to `translate3d(0, calc(100cqh + 48px), 0)`, duration `(H + 96) / speed`, negative delays. 30% of drops (40% heavy)
  own a splash `<i>` at the bottom edge sharing the drop's duration: hidden 0 to 92%, then two dots `translate(+-8px, -7px)` and fade over 92 to 100%.
- Snow: 30 flakes, 2 to 6 px soft (`radial-gradient` of `--weather-ink`), size is depth: opacity `.45 + .45 * (size - 2) / 4`, speed `22 + 18 * (size - 2) / 4`
  px/s; the outer span falls plus `translateX(calc(var(--wind) * 40px))`; an inner span on the 15 largest is a pendulum (`transform-origin: 50% -400%`,
  `rotate(-9deg to 9deg)`, 1.6 to 2.4 s, sine in-out, negative random delay). A 12 px pile at the bottom grows `scaleY(0 to 1)` from the bottom over 90 s
  `cubic-bezier(.22, 1, .36, 1)`, capped at .5 under intensity .5, fading out over 1.2 s when snow stops.
- Fog: 3 layers (opacity .14/.18/.12, `scale(1.6/1.3/1.0)`, each 180% wide with 4 radial ellipses, no blur) drifting `translateX(-10% to 10%)` over
  46/34/26 s alternate, each breathing `opacity x .7 to x 1` over 5/7/9 s. Sun or moon at .35, no stars.
- Lightning (thunderstorm): `scheduleStrike()` in `weather-lightning.ts`: first strike 1.5 to 6 s after mount, then uniform gaps of 6 to 18 s; 25% are doubles
  whose second strike starts at least 1000 ms after the first (so no hero-wide flash repeats more than 3 times in any 1 s window, WCAG 2.3.1; a fake-timer test
  asserts the cap). A strike sets `data-strike="a|b|c"` and `--wx-bolt-x` (20 to 80%); CSS plays one of three authored 20-segment bolts (static `drop-shadow`
  glow in the token, never animated) as `wx-strike` 560 ms (`opacity 0, .95 @ 0ms, .30 @ 60ms, .85 @ 100ms, 0 @ 560ms`, `cubic-bezier(.16, 1, .3, 1)`), a sheet
  overlay peaking at .55 on the same envelope, and a cloud-light overlay (top 55%, `mix-blend-mode: screen`, peak .5). Thunder jolt (`thunderJolt`, default true on
  full and wide, false on compact and lite): the hero `translateY(-4px)` at +160 ms settling over 420 ms. The attribute clears on `animationend`; the
  scheduler stops on pause, unmount and reduced motion.
- Wind extras (leaves, swooshes): not built (clip art on a calm card). Wind shows through cloud and snow speed.

## 6. Orchestration

First paint: every loop's 0% keyframe is its resting look; only stars (1.2 s) and an incoming condition fade in. Condition change: the outgoing group gets
`data-leaving` (opacity to 0 over 400 ms) and unmounts; the incoming group fades in over 800 ms after 300 ms; clouds persist across changes. Pause:
`useSceneRunning(ref)` (one shared `IntersectionObserver`, `rootMargin: 100px`, plus `visibilitychange`) sets `data-running="false"` and CSS pauses every
`[data-fx]`; the lightning chain and the ticker stop too. Reduced motion (`prefers-reduced-motion` and `html[data-ease-motion=calm]`): replace `animation:
none` with `animation-play-state: paused !important; transition: none !important`. The kit's global reduced-motion rule (tokens.css ~1419) sets
`animation-duration: 0.01ms !important; animation-iteration-count: 1 !important` on every element, under which the negative delays land past the end and a
paused animation shows the unanimated base. So the weather rule is a SCOPED EXCEPTION to that global rule: `[data-fx] { animation-duration: var(--d)
!important; animation-iteration-count: infinite !important; animation-play-state: paused !important; }`, listed here and in the test, which asserts the frozen
mid-state (a computed `animation-duration` equal to `--d` and play-state paused), not only the rule text. The negative delays then leave a complete still frame (populated clouds, rain across
the hero, flakes in the air, the pile at full height, stars on, the storm showing bolt A at .7 with the sheet at .25). Variants and budgets (`full | compact | wide |
lite`; `lite` is the location card): running animations max 90 full, 110 wide, 50 compact, 24 lite. Lite: 2 clouds, rain 8, snow 10 (no pendulum, no pile), stars 18, no
splashes, no corona, no grain, no jolt. The documented budgets are below today's count (76 drops plus 72 stars); the controls design's "about ten concurrent animations" applies to the smart-home tiles, not a weather hero; on the forecast page with many places the off-screen pause keeps the visible `lite` cards within bounds. Z-order: sky 0, fog and pile 5, precipitation 10, light sources, stars, lightning 20, clouds 21 to 23, cloud-light and sheet
24, text 30 ("weather moves behind the words").

## 7. API (additive; existing callers keep working)

`WeatherSky`: `{ cls; isDay; code?; intensity?; elevation?; sunrise?; sunset?; now?; wind?; moon?; variant?: "full" | "compact" | "wide" | "lite"; thunderJolt?;
seed?; running?; paused? }`. `intensity` becomes live (default `weatherIntensityOf(code)`); `paused` is deprecated for one release and maps to `variant: "lite"`; the sky
paints the gradient itself and exposes `data-phase`, `data-running`, `data-intensity`. `WeatherCard` gains `sunrise?`, `sunset?`, `wind?` (km/h), `now?`, `thunderJolt?`,
passes `variant` through, and drops its own gradient and flat scrim. `weather-forecast-page.tsx` does the same; its location cards pass `variant="lite"`. The spec
weather answer block gains optional `sunrise`, `sunset` and `wind_speed` (km/h, stated in the schema), the same field set the open WEATHER-PORT-02 row reads for its sunrise,
sunset and wind hero tiles (one field set, no second one; the forecast page's `ForecastDetail` already uses these names, and the weather package's recipe already selects
them from the same provider response, so there is no new outbound call). Spec first, then the weather package fills them.

Tests that change: `weather-card.test.tsx` counts (72 stars, 76 fall, 60 flakes, 2 and 5 clouds, the splash band) become per-variant budget and presence checks; the
hero `backgroundImage` assertion becomes `data-phase` plus `--wx-top` set on the sky; the keyframe-name test lists `wx-drift, wx-fall, wx-flake, wx-sway, wx-twinkle,
wx-fog, wx-breathe, wx-corona, wx-strike, wx-sheet, wx-jolt, wx-pile, wx-splash`; `weather-contrast.test.ts` is rewritten as in section 2; the `moon-disc`
tests drop the drop-shadow animation. New tests: phase thresholds (from elevation, from times, the `isDay` fallback); every derived stop under the L caps; intensity for all 28
codes; counts and animation totals per variant within budget; `data-running` flips with a mocked observer and `visibilitychange`; the reduced-motion rule is
play-state paused, not `none`; a keyframe lint (no `filter`, `box-shadow` or `background` in any `wx-*` keyframe; 0% is the resting state except strike, sheet, splash);
lightning gaps within 6 to 18 s, the 3-flashes-in-1-s cap, and cleanup on unmount under fake timers; the frozen mid-state under reduced motion; wind factor bounds; no colour literals outside tokens.

## 8. Slices (each lands alone; WEATHER-SCENE-01 to -07 in the backlog)

1. Scene foundation: `weather-scene.ts` (palette, phase, Oklab mix, caps, light position, `weatherIntensityOf`), `weather-sky.tsx` paints gradient, glow, vignette, grain and
   scrims from registered properties, new props with defaults, callers stop drawing gradients, contrast and phase tests. 2. Clouds. 3. Precipitation and fog.
   4. Light sources. 5. Lightning. 6. Orchestration (running, cross-fade, reduced-motion still frame, `lite`, budgets, deprecation, keyframe lint, docs, screenshots).
   7. Spec and hub: the optional `sunrise`, `sunset`, `wind_speed` fields (shared with WEATHER-PORT-02) on the weather block (spec first, then the weather package fills them). Slices 2 to 5 depend only on 1;
   6 finishes last; 7 can run beside them.

## 9. Supersedes

| Replaced | By |
|---|---|
| The binary `is_day` two-stop gradient tokens (`--weather-{cls}-{day|night}-{from|to}`) as the only sky | The continuous phase palette above; the old tokens stay as the fallback values until the contrast proof passes, then are removed in slice 1. |
| Fixed particle counts (72 stars, 76 rain streaks, 60 flakes, 5 hand-placed clouds) and the tests that pin them | Per-variant pools and budgets; the tests are rewritten deliberately (section 7). |
| The `paused` prop (cuts counts only) and the dead `intensity` prop | `variant: "lite"` and a live `intensity`; `paused` is deprecated for one release. |
| The `moon-glow-pulse` filter keyframe and `animation: none` for reduced motion (the media query and the `html[data-ease-motion="calm"]` copy, tokens.css ~1702 to 1709) | An opacity-only moon glow and the scoped paused exception with a designed still frame (section 6); the duplicated calm rule is merged. |
| The `wx-rays` (60 s) and `wx-bolt` (6.5 s, fixed period) keyframes | The corona (90 s, scaled and faded) and the scheduled lightning (section 5). |
| The day test in `weather-forecast-page.tsx` (`minutes >= sunrise && minutes < sunset`) | The one phase function in `weather-scene.ts` (principle 1: it replaces the test, it does not sit beside it). |
| The light and dark sky token variants (`--weather-{cls}-{day\|night}-{from\|to}` in the three tokens.css blocks) | The new `--weather-*` palette tokens in the same three blocks (section 2). |
| The 2026-10-16 owner call (`docs/plans/weather-card-and-app-2026-10-16.md`) "animation is modern CSS plus tokens; gradients from tokens (light and dark)" | Kept, not superseded: colours stay tokens in all three blocks; only the binary two-stop shape changes. |

## 10. As built and revised (2026-11-07)

The scene shipped as `commons` ui-v0.5.507 to 0.5.518 (slices 1 to 6, the data pass-through of -07, and two picture polish passes). What
changed against the text above, so the note stays true:

- **Sun and moon.** The conic corona with spokes is gone (owner feedback 2026-11-07: a rotating thin spoke read as a white streak on sunny
  cards). The corona is a soft radial glow that breathes. The moon is always the real `MoonDisc`; with no `moon` prop its phase is computed from
  the date (synodic month and a reference new moon in `weather-scene.json`). Stars fade with `--wx-night` instead of showing at full strength at dusk
  and dawn. The sun disc is 56 px (64 px at twilight) after the art review; halos 140 px and 300 px.
- **Clouds.** Silhouettes are mask-image puffs with soft rims and no blur, in three depth layers, opacities near .96, mid .74, far .42, with a
  shaded `::after` body, a rim light and an offset shadow. The flat shelf is `clip-path: inset(...)` driven by a per-shape `--shelf`, not a mask
  composite (the browser reduced the composite list to "add" and every cloud became a slab: ui-v0.5.517 is broken, use 0.5.518). Puff tables are the
  authored ones, scaled to fit the element box with a 4 percent margin.
- **Sky.** Caps raised to top .50, mid .56, bottom .58 (proved against white ink by the contrast test, which now composes the real gradient, the
  `to top right` text scrim, the horizon layers and the variant-conditional flat scrim for every class, phase, variant and theme block). The flat
  scrim applies only on `compact` and `lite`; the vignette starts at 62 percent. Dusk and dawn use lavender over salmon, with a horizon glow layer that
  exists only near twilight and a pale day horizon. Clear and partly-cloudy day mid and bottom stops were lowered slightly to keep 4.5:1.
- **Precipitation.** Rain has near, mid and far drop classes (visible streaks with a bright head, -4 degree tilt, -10 heavy); snow sizes are 2 to 11 px
  with soft pendulum flakes, hard discs, a haze layer and a softer pile. Wrappers are always sized (`inset: 0`); a test guards every `*-field`.
- **Lightning.** `scheduleStrike` with injectable timers, doubles at least 1000 ms apart, three authored bolts, sheet and cloud-light overlays, thunder
  jolt on full and wide, no scheduling under reduced motion; a still frame (bolt A at .7, sheet .25) via `data-reduced`.
- **Orchestration.** `useSceneRunning` (one IntersectionObserver plus visibilitychange), a 500 ms cross-fade between condition groups, the scoped
  reduced-motion exception, per-variant animation budgets (a test counts them), `paused` deprecated for `variant="lite"`.
- **Data.** The weather answer block carries optional `sunrise`, `sunset` and `wind_speed` (spec 0.1.335); the weather package fills them only when
  valid; the kit passes them to the sky.
- **Lessons recorded.** bun and happy-dom do not parse CSS: three real defects (a comma before a `color-mix` percentage, an unsized wrapper, a
  `mask-composite` list) passed every test and were found only by looking at the picture in a browser. Judge each slice as a picture, and keep text tests for
  CSS shapes that have bitten once.

