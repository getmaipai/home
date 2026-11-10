# Voice-reactive layer: parts that move with the voice, for characters with no mouth (2026-11-10)

Reuse check: grepped `getmaipai/*` for voice-reactive, glow, pulse, antennas, `mouthLevel`, `drawEnvelope`. Existing and reused: the companion pack spec (`commons/spec/schemas/companion-pack.schema.json`, spec 0.1.364), the kit pack player and its speech inputs (`commons/ui/src/elements/companion-pack/`: `player.tsx`, `compositor.ts`, `speech.ts`, `types.ts`; the 100 Hz speech `envelope`, the `cues`, the `state` prop), the pure modules `cues.ts`, `loud.ts`, `life.ts`, and the notes `companion-pack-2026-11-10.md` and `companion-maker-2026-11-10.md` (this note adds one layer to that pack format, no second format). `CompanionAvatar`'s `mouthLevel` (TALK-01) is a mouth crop for human faces and stays for companions without a pack; nothing else in any repo drives a part from the voice. RULES.md rule 9 (kit Elements as they ship): the layer lives inside the pack player, Home only wires the pack.

## Supersedes
Nothing built is replaced, but it AMENDS the approved companion-pack-2026-11-10.md in two places: "Pack format" (`states`, `mouth`, `emotion` and `life` are required only when there is no `voice` layer) and "Player" (the still-plus-parts path draws on a 2D canvas; video packs keep WebGL). It adds an optional `voice` layer to the companion pack (MAKER-G). It does not replace the mouth layer: a character with a human mouth keeps `mouth`; a character without one (a robot, a creature with a beak, a blob) uses `voice` instead of, or beside, it.

## Why
A character with no mouth still has to look like it is the one talking. MaiPai (white round robot, navy visor, two yellow happy-arc eyes, a red heart on its chest) has nothing to open. Its heart can pulse and glow while it talks and thinks, its eyes can squash a little with the voice, and its visor can catch light. This is the cheapest animation in the pack family: no video, no flow files, a few small pictures.

## The layer (one slice)
The pack gets an optional `voice` object:
- `base`: the rest picture with the reactive parts erased (the holes filled with the colour around them). Optional; when absent the rest picture is the base, which is right only for parts that never shrink below their drawn size.
- `parts` (1 to 12): each is a picture (WebP or PNG with alpha) cut to a `box` in the same 480 pixel tile space as the rest picture, an `anchor` inside the box (0..1, default the centre) that scale and rotate pivot on, a draw order `z`, an optional static `glow` (`color`, `blur` px), and a list of `effects`.
- `presets`: per state (`idle`, `listen`, `think`, `speak`, `interrupt`) a `gain` (0..2, default 1) that scales every effect while that state is current.

An effect is `{ channel, curve?, smoothing?, drive?, blinkMs?, scale?, scaleX?, scaleY?, rotate?, translate?, opacity?, brightness?, glow? }`:
- **channel** says what drives it: `level` (the speech envelope at the audio clock, 0..1, clipped), `cue_energy` (how open the current mouth cue is: silence and closed lips 0, wide vowel 1), or `state` (a per-state `drive`).
- **curve** shapes the driver: `linear`, `ease-in`, `ease-out`, `smooth`; `pulse` (a sine at `hz`) and `blink` (a short dip every 1/`hz` seconds lasting `blinkMs`) are for the `state` channel only.
- **drive** (state channel) gives each state `{ amount, hz, depth, beat }`: a steady amount, plus a pulse or blink of `depth` at `hz`, plus one beat of `depth` when the state is entered.
- **smoothing** `{ attackMs, releaseMs }` is a one-pole follower on the driver. Calm defaults: 60 ms attack and 220 ms release for `level` and `cue_energy`; none for `state` (its shapes are already smooth).
- The properties are `[from, to]` ranges the 0..1 driver is mapped onto: `scale` (uniform), `scaleX`, `scaleY`, `rotate` (degrees), `translate {x, y}` (tile pixels), `opacity`, `brightness` (1 to 2, drawn as an added light pass because Safari has no canvas filter), `glow` (strength 0..1 of the part's glow colour). Several effects on a part combine: scales multiply, rotate and translate add, opacity multiplies, brightness multiplies, glow takes the largest.
- **Calm limits** hold for every pack whatever it asks for: scale 0.05 to 1.5, rotate within 15 degrees, translate within 24 pixels, brightness 1 to 2. Speak then listen (the person cut the companion off) plays the `interrupt` preset for 400 ms before `listen`.
- **Reduced motion, pause and sizes of 36 px or less show the plain rest picture.** No part moves. Every effect therefore has a calm default and a still fallback.

## The no-video case: a still plus parts pack
A pack with a `voice` layer may omit `states`.
- **Spec:** `states`, `mouth`, `emotion` and `life` leave the schema's `required` list; `validateCompanionPack` (TS and Python) requires them only when `voice` is absent, with the plain message "states is required unless the pack has a voice layer; add states or add a voice layer with parts." The minimum for a still-plus-parts pack is `version`, `id`, `name`, `tile`, `rest`, `voice` (at least one part), `budget`, `provenance`. The validator also checks unique part ids, boxes inside the tile, `pulse` and `blink` only on the `state` channel, `drive` only there, a glow colour on any part with a glow effect, an effect that changes something, that every listed picture exists in the file list, and the byte budget. Existing packs stay valid; `manifest.schema.json` is untouched.
- **Player:** `CompanionPackPlayer` takes the still-plus-parts path when `pack.states` is absent. One 2D canvas (480 px, 320 px on a phone), no `<video>`, no WebGL, no stacked-alpha decode. Each frame it draws `voice.base`, then the parts by `z`, each at the pose the effects give it, from the same `state` and `speech` props the video player uses (`speech.envelope` or `loudness` at `speech.clock()`, and `speech.cues`). Idle and listen with no speech draw at 30 fps, speech at 60 (30 on a phone); the loop stops when the tab is hidden or `paused`. A pack with both `states` and `voice` plays as a video pack and ignores `voice` for now.

## MaiPai's parts (built by script, `scripts/pack/make_maipai_pack.py`)
The script cuts the parts out of the one MaiPai picture by colour keying on the known colours, fills the holes into `voice/base.webp`, and writes `pack.json` (about 47 KB of pictures, budget 1 MiB).
- **Heart** (anchor just below its centre, `glow` red, 26 px blur). On `level`: scale 1.0 to 1.12 and glow 0 to 1, attack 40 ms, release 200 ms. On `state`, sine pulse: scale 1.0 to 1.06 and glow 0 to 0.5; idle a slow 0.25 Hz at depth 0.35 (breathing), think faster at 0.9 Hz with a steady 0.15 and depth 0.6, listen one beat when entered, interrupt one beat at depth 0.6. Speak has no state pulse, so the voice alone drives it.
- **Two eye arcs** (one part each, pivot on its own centre). On `level` with ease-out: scaleY 1.0 to 0.9, scaleX 1.0 to 1.04, lift up to 3 px. On `state`, a periodic happy blink (the arc flattens to 12 percent of its height for 150 ms): idle every 4.5 s, listen 3.6 s, think 6.3 s, speak 3.3 s.
- **Visor sheen** (optional): a soft diagonal highlight clipped to the visor, opacity 0 to 0.3 with `level` (smooth, slow attack and release), so the visor brightens while it talks.

## Deferred (not in this slice)
- **Antennas** and other parts that need a bend or a chain (a rotate-about-a-base with follow-through); needs a second anchor and a spring model.
- **Non-human mouths** (a beak, a muzzle, a slit): a part with a two-picture mix (closed, open) driven by `cue_energy`; the channel and the maths exist, the two-picture part type does not.
- A true **visor sweep** (a highlight moving across a clipped window) rather than a fade; needs a clip region on a part.
- A transparent cut-out of the MaiPai body (the source picture has a flat grey background that the still keeps).
- `brightness` below 1, a `voice` layer on top of a video pack, parts that read the shout mode or emotion kind, and a maker route that finds the parts for any starting image.
- Home wiring: Home does not play MaiPai yet; this slice is the format, the player and the pack script.

## Safety (RULES.md 0 and 10)
The MaiPai pack script runs no model: it only cuts and resizes an existing still. A pack made for a household goes through the maker's checks (MAKER-D, `checkCompanionArt` on every output).

## Follow-up
Antennas and non-human mouths are deferred to a follow-up row; the MAKER-G acceptance needs only the heart and the eyes.
