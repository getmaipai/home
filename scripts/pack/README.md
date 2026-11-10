# Companion pack tools (PACK-02)

Design: `docs/design/companion-pack-2026-11-10.md`. Schema and validator: `@maipai/spec` (`companion-pack.schema.json`, `validateCompanionPack`, tag spec-v0.1.360).

## Build the three demo packs
Packs are written to the git-ignored `data-scratch/packs/<id>/` of the main checkout; the source is the demo in `data-scratch/poc-companions` (read only).

    /Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/poc-companions/refs/venv/bin/python scripts/pack/build_pack.py man
    ... clay, pixar     (flags: --no-lossy, --no-deflate, --trim auto|always|never, --skip-phone)

Validate (finds the spec from `MAIPAI_SPEC_DIR`, then the pinned `@maipai/spec`, then `commons-tags/spec-spec-v0.1.360`):

    bun run scripts/pack/validate_pack.ts <pack folder>
    bun test scripts/pack

## Pack layout and file conventions (the player relies on these names)
- `pack.json`, `rest.webp`, `build-report.json` (not part of the desktop budget with `*.phone.mp4`).
- `clips/<name>.mp4` (H.264 BT.709, matte stacked under the colour, 480x960), `clips/<name>.phone.mp4` (320x640), `clips/<name>.track.json` (per-frame 2x3 affines `m` and a scalar `res`). 24 fps, 117 frames.
- `mouth/<calm|shout>/`: `atlas.webp`, `meta.json` (cols, rows, tile size, base, ts, nt, region, letters), plus `flow.bin.z`, `weight`, `samples`, `rest` for the real man (warp) or `alpha` for the cartoons. Atlases are 27 rows by 10 columns: 8 letter tiles plus baked in-betweens. `letters.wide` index 8 means the shout set.
- `head/`: `flow.bin.z`, `meta.json`, `weight.webp`. `eyes/`: `closed`, `half`, `ref`, `ring` (`.webp`) and `meta.json`. `emotion/`: `meta.json`, `<kind>.flow.bin.z`, `<kind>.webp` for angry, excited, alarmed, sad.
- Flow files are `int16` pairs, zlib level 9; read them with `DecompressionStream('deflate')`.
- Mouth, head and eye atlases and emotion pictures are lossy WebP (q92, alpha lossless, minimum 38 dB); masks, weights, eyes and the rest picture are lossless.

## Sizes (desktop tier, budget 12,582,912 bytes)
man 5.2 MB, clay 8.8 MB, pixar 8.5 MB; phone twins add 0.6 to 0.8 MB.
