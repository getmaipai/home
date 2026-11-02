# Video tiers: LTX for every tier, Wan and H3 parked (design draft, 2026-11-02)

Status (2026-11-02): proposed; architect ruling pending. No code. Item: VIDEO-TIERS-01. Amends the video rows of
[resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) section 5.3 and follows
[video-create-2026-11-01.md](video-create-2026-11-01.md). Measurements are in
[video-speed-bench-2026-11-01.md](video-speed-bench-2026-11-01.md); this note decides from them.

Owner direction (Jesse, 2026-11-02): forget MiniMax-H3 for now (slow, crashes with pictures, no usable Mac port); optimize the best
LTX version as Max; Standard must be fast and ideally have sound and picture together; Wan only if it is truly the best
for speed.

## Supersedes

Nothing is replaced until the Stack can run and pin the runtime (open item 2); then these rows change:
- [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) section 5.3: Standard (Wan2.2 FastWan, silent, 480p, 44 GB) becomes LTX-2.5 q8
  at 512x288 for 10 s, with sound, for adults; Boost (LTX-2.3 distilled at 768x448) becomes LTX-2.5 q8 at 640x352 or 768x448; Max ("LTX-2.3
  dev two-stage" and "Max video stays empty for now (owner, 2026-10-30)") becomes LTX-2.5 under the 64 GB limit below; the 4-bit LTX-2.3
  research paragraph is closed (quantized 2.3 damages the sound).
- Section 4's Max limit for video (Max = R, about 72 GB, or about 95 GB with Reduced) is replaced for the video category only by the
  owner's 64 GB per clip, measured as the OS footprint.
- Section 3's video hint words "Quick clip" and "With sound" no longer fit once Standard has sound; the Create screen names the levels
  Standard, Boost and Max (the closed ladder of section 12.1 stands: Reduced, Standard, Boost, Max; "Normal" is not a tier).
- Quick and Detailed pins (`video-generation-2026-10-17.md` section 14): for adults, Standard becomes a model behind a licence the admin
  accepts once; the install handles it as it does today (the licence prompt, LICENCE-ACK-01), and until it is accepted an adult's Standard
  falls back to Wan Quick (silent). VIDEO-LTX-01 and VIDEO-LTX-04 are answered by this note; VIDEO-LTX-07 (the LTX download) stops being
  optional and becomes the adult Standard floor; VIDEO-LTX-05 (the LTX-2.5 and 1024x576 bench) is partly answered here.
- `resource-tiers` section 14 E3 and TIER-EVAL-03: the Wan candidates are dropped for adults (VIDEO-GEN-09, VIDEO-GEN-11, VIDEO-EVAL-01
  stay open only for the minors' Wan lane); the LTX-2.3 dev two-stage Max path is replaced by LTX-2.5.
- [video-create-2026-11-01.md](video-create-2026-11-01.md): bench row 11 and section 9a's "MiniMax-H3 itself is a Max candidate" are
  parked; bench row 9 and "Max video stays empty until it passes" are replaced by section 3 here; bench rows 1, 2 and 4 ("on Wan and LTX",
  "both models") now mean LTX only for adults.

## 1. What we measured (owner-judged, one clip each unless noted)

| Candidate | Time for a 5 s clip, 768x448 | Sound | Owner verdict |
|---|---|---|---|
| Wan FastWan 5B (today's Quick) | 22 to 42 s | none | rejected: "all awful" |
| LTX-2.3 bf16 | about 83 s (68 to 93) | yes | good; cartoon characters and voices strong |
| LTX-2.3 q8 / q4 | about 70 s / about 67 s | degraded | q8 muffled static, q4 awful laugh track |
| LTX-2.5 q8 (fork runtime) | 90 to 140 s for 8 s | yes | the Calico commercial was clear |
| H3 8-bit + Turbo (Argus) | about 195 s | yes | picture strong, voices not the characters, Golden Girls "awful" |
| H3 bf16 + Turbo | about 255 s | yes | richer picture |
| H3 other runners | `h3.c` 162 s, Sol-Attn 184 s, PipeNetwork 323 to 434 s | yes | no win; PipeNetwork peaks at 113 GB |

Times are generation only, from each tool's own log, and many ran while the machine was busy (load average 11 to 15). Peak memory
is not comparable: LTX comes from the model's counter, H3 from the OS footprint, which misses streamed weights.

## 2. Decisions

1. **Minors keep the silent Wan Quick lane.** Parking Wan is for adults only. A child's and a teen's clip stays on Wan Quick, silent
   (`videoModelForLane`, `lib/pictures/lane.ts`), until VIDEO-LTX-06 (the audio check on generated speech) ships, because today's
   finished-clip check does not listen to the sound (rules 0 and 10 keep every protection for a child or teen). Rule 8 still holds: a
   minor gets no tier choice.
2. **MiniMax-H3 is parked.** Reasons: 2.3 to 3x slower than LTX; its picture mode (first frame, reference) crashes in the Mac
   port; no Turbo-compatible faster runner won; the only reference runner is a community repo, and rule 11 needs a Stack-owned,
   tested component. Reopens when a picture-capable Mac runner exists and the Max bench says it is worth the time.
3. **Wan is parked for adults.** Rejected on quality by the owner. It stays only as the speed floor (22 to 42 s, silent) to compare against.
4. **LTX is the adult family for every tier.** Quantized LTX-2.3 damages the sound, so Standard must not be a 4-bit or 8-bit 2.3 build.
5. **Cutting the refine pass is out.** `--stage2-steps 2` saved about 9 s and the owner judged the clip "messed up".
6. **Caching is out for clips with speech.** H3's block cache and TeaCache-style reuse hurt faces and words; the LTX runtime's own
   TeaCache is calibrated for 2.3 only and errors on 2.5.

## 3. Tier proposal (owner choices 2026-11-02 and measured numbers)

| Tier | Choice | Measured (M5 Max, LTX-2.5 q8 distilled, with sound) |
|---|---|---|
| Standard | 512x288, 10 s (241 frames) | about 43 s; footprint 39.4 GB; owner: "perfect" on the 10 s Smurfs and SpongeBob clips; two-line speech exact at 10 s and 15 s |
| Boost | 640x352 or 768x448, up to 10 s | 5 s: 42 to 49 s at 640x352 (32.4 GB), 64 to 74 s at 768x448 (45.8 GB) |
| Max | 10 s, 15 s or more, under a 64 GB per-clip footprint cap | 1024x576 5 s: 87 to 101 s but footprint 68.6 to 69.2 GB, FAILS the cap; cause not isolated (not the VAE decode budget, not eval-every); bf16 and 15 to 20 s runs pending |

Wan's silent floor is 22 to 42 s per 5 s; Standard is within 2x of it with sound. Each tier keeps rule 8: a minor stays on the Wan Quick lane (decision 1); Max stays
admin-gated. The Max cap is the owner's (wizard, 2026-11-02): 64 GB total on top of the live hub's about 28 GB, measured as the OS
footprint, not the model's own counter.

Upscale (not a tier): the Lightricks pixel spatial upscaler IC-LoRA works through `generate --dfr --detailing-lora` (about 1.5x slower
than plain distilled at 1024x576); the `ic-lora` command with a distilled model produced garbage. A plain 2x ffmpeg stretch costs 0.4 s.
Float16 compute and sparse attention gave no speedup at 512x288 on this Mac.

Prompt lessons that belong in the Create UI (Look chip, hint, Voices chip): name and describe each cartoon character and state the era
and animation style (a vague prompt gave live-action Smurfs); one speaker at a time in separate turns; spell hard names phonetically;
never put stage directions inside the dialogue (the model speaks them).

## 4. Open items

- **Newer runtime:** the speed switches the research found (float16 compute, sparse attention in the refine stage, untiled decode
  budget) exist in `dgrauet/ltx-2-mlx` 0.18.0 and need the official `dgrauet/ltx-2.5-mlx-q8` and `ltx-2.5-mlx` packs (gated, accepted
  by the owner 2026-11-02). Our fork runtime (0.14.15) lacks them.
- **Rule 11:** the Stack must own and pin whichever runtime wins; today's runs use scratch repos.
- **Real people:** no model reproduces a named real person's look or voice from words. Reference pictures keep a look; a trained
  likeness LoRA and a voice made from a recording are untested.
- **Sound:** exact spoken words are unreliable with two speakers; one speaker at a time, written as separate turns, works better.
  The Create prompt bar should offer a clean-dialogue wording and a re-roll.
- **Memory measurement:** every tier needs one method, measured the same way, before any admission number is set.
