# Swap composite: what worked and what failed (2026-11-17)

Source of the numbers: one 10 s vertical test clip (a person in a cowl that is ripped off, then the bare face fills the frame). It stays in private
scratch as the standing occlusion test for the head swap. This note is the method for the swap job; it names no model on purpose.

## The rule

A swap is real footage with only the person replaced. A guided generation redraws the whole frame (lighting, hands, cowl, background drift), so its
output is only a donor. Every swap job ends in a composite: original pixels everywhere except a head mask, which takes colour-matched donor pixels.

## Method, in order

1. **Remove burned-in text first.** Erase captions and logos from the guide before generation, so the generator never redraws them. A plain delogo
   box over the caption (1080x1920 source, box about 740x135) left no trace on a dark background. Run it on the full-resolution original too.
2. **Reference photos are head-only crops.** Crop each photo to the one head with a little hair and neck margin; never include any part of another
   person. A photo where another head touches the face cannot be cropped cleanly: leave it out, or paint the other person out first. Use up to three
   references: the sharpest front-on photo first, then two with other angles and lighting. Upscale each to 512x512 (Lanczos plus a light unsharp mask),
   padding a non-square crop with a flat neutral colour. Identity improved a lot when the single small photo became three clean head crops.
3. **Segments.** Cut the source to 24 fps and to 56-frame segments (2.333 s). Starts: 0, 2.333, 4.667, 6.667, 7.667 s; use the overlap to hide the
   first frames of the last segments. Use the whole portrait frame at 288x512, not a landscape crop: a crop loses the head as soon as it turns.
4. **Prompt per phase.** One prompt for cowl-on frames (keep the cowl, replace only the visible lower face), one plain "replace the head" prompt for bare-face
   frames. Long cowl-specific wording did not help; the plain head prompt swapped bare faces, the cowl prompt kept the cowl.
5. **Generation settings that decided success.** Head-swap adapter strength 1.4 to 1.6 and a changed seed rescued segments that came back almost unchanged
   (donor within about 31 dB of the guide means no swap; a swap lands near 17 to 28 dB). Check this number for every segment and re-take with another seed
   and a stronger setting. The first frames of a segment can come back unswapped when the head is blurred or half out of frame: start that segment about
   0.33 s early and discard the overlap.
6. **Mask, cowl on.** Donor skin only (face segmentation of the donor: not hair, cowl, shadow or background), intersected with the area the ORIGINAL shows
   as skin. In very dark footage skin is warm (red at least blue, about -1 on blue minus red) while the cowl, cape and suit are blue-tinted (+12 to +16);
   threshold blue minus red below 11 after a 2.5 px blur, red above 20, open 9 px, close 31 px, fill holes in the face-sized region (a mouth opening
   leaves a hole and doubles the mouth if not filled). Keep only the largest region so eye openings stay original. A stricter or YCrCb skin test gave
   empty masks (no swap) or blotches.
7. **Mask, cowl off.** When the original shows more than 12 percent skin, the mask is the donor's whole head (skin and hair), grown 17 px, limited to
   within 100 px of the original's skin so nothing is ever painted onto an empty background or a fade, and cut at 90 percent of the frame height.
8. **Edge.** Feather 2.5 px at 3 px sigma after a 5-frame (+-2) average of the binary masks, then 9 frames (+-4) for faster motion. No gradient into the cowl.
9. **Colour.** Per frame, in LAB, match mean and contrast of the donor's brighter half of the masked pixels to the original's brighter half (hair and shadow
   stay out of the statistics). For bare heads match only 55 percent of the way, otherwise the new face turns muddy in the dark scene. Then add the
   original's own grain: Gaussian noise at 0.8 of the original's high-frequency standard deviation inside the mask (the donor is smooth).
10. **Time.** Measure optical flow on the ORIGINAL footage (half resolution, contrast-stretched because the footage is dark), warp the previous result
    forward with it and blend inside the mask (0.4 new frame for slow shots, 0.7 for fast head motion). Flow on the original drives the donor texture, so the
    donor's own jitter cannot show. Do not run this filter with 0.4 on a fast head turn: it smears.
11. **Join.** Concatenate segments, cutting each overlap, to 240 frames at 24 fps. Replace the audio completely (new track, first 10 s, fade out the last
    0.5 s); nothing from the original sound stays. H.264, yuv420p, AAC, faststart: about 4 MB for 10 s at 1080x1920.

## Checks to make part of every swap job

- Donor-versus-guide PSNR per segment (below about 29 dB means swapped; above about 30 dB: re-take).
- Seam strip: frames either side of every join must not show the old face.
- Mouth flicker (motion-compensated mean absolute frame difference inside the mask, using the original's flow): composite at or below about 1.25 times
  the original's. Measured here, original / before filter / after filter: 2.52 / 2.85 / 1.41 and 3.73 / 3.94 / 1.88 (slow pieces); 3.61 / 6.65 / 5.22,
  7.07 / 8.33 / 6.06 and 6.54 / 7.45 / 5.42 (fast reveal pieces, where the original itself is noisy).
- A strip per segment: original, donor, composite, mask; judged by opening the frames, plus a full-resolution zoom of the mouth and jaw.

## Memory and time (Apple silicon, 128 GB)

A 56-frame swap segment peaked at 66 GB at 384x288 (landscape), 85 to 90 GB at 512x384 and about 89 GB at 288x512 (portrait). Each segment took 3 to 5
minutes. Free memory with the household chat model loaded was about 78 GB, so a job asks for the largest shape that fits.

## What each failure looked like

- Guide redraw: "a reimagining of the original and the photo". Fixed by the composite, not by stronger settings.
- Whole head replaced under a cowl: the cowl vanished. Fixed by gating the mask to original skin.
- Skin gate too strict: composite equal to the original (no swap). Too loose: smudges around the eyes, a blob on the chin (a mask leak), ragged cowl edge.
- Mouth with a seam or doubled lips: the original's mouth opening was a hole in the skin mask, and the donor's left cheek was dark enough to drop out of
  its own mask. Fill holes, lower the donor luminance floor.
- Muddy bare face: colour match over a mask that included hair and shadow.
- Blue-tinted patches at the head edge: mask grown too far into the background.
- Mouth shimmer ("not stable"): donor mouth motion differs frame to frame. Fixed with the flow-driven blend and wider mask averaging.
- A donor that is the original again: a segment the generator did not swap. Take another with a new seed.

## Not done yet

- Face landmarks (installed in a private venv for this work: MediaPipe 0.10.21, face_landmarker.task, sha256 64184e22...). They find the face under the
  cowl on front-on frames but not on turned or occluded ones, so a landmark-driven warp covers about a third of this clip. Keyframe propagation of one
  fixed donor mouth texture, driven by the original's mouth, is the next step.
- The donor keeps its own gentle smile in cowl frames instead of following the original's speech.
- Hard jaw and hair edges where the head is cut from the donor; the original's hair stays around the new face.
- Small brightness steps at segment joins.

## Added later the same day

- **Bare-head mode must start late.** The mode that takes the donor's whole head started when the original showed more than 12 percent skin, which is while
  the cowl is still being dragged off; it painted bare scalp over the cowl so the cowl "vanished". The threshold is now 20 percent, the grown mask is limited
  to 30 px (not 50) around the original's skin, and the feather is 1.2 px. Before that point the cowl-on rule (donor skin only where the original shows skin)
  applies, so the cowl, glove and cape keep sliding frame by frame. In the blue-minus-red map, skin is a clean dark blob and fabric is bright or mid grey.
- **Cowl outline check.** Cowl = blue minus red at least 11, luminance 10 to 80, after a 2.5 px blur. Compare the original's cowl mask with the composite's
  inside the swap area (grown 40 px); report the overlap. Measured on the reveal piece: mean 0.72, worst frame 0.52. This colour test is noisy on dark
  footage, so it must be read next to the strip with the outline drawn on it.
- **A head cut off by the frame cannot be swapped by the generator.** A canvas widened 40 percent with an edge-smeared guide fits in memory (66 GB at
  352x448) but the generator copied the smear and did not draw a head. What is left for those frames: recolour leftover original skin with the donor's
  skin tone while keeping the original's light and shadow, or extend from neighbouring swapped frames. The original silhouette still shows.
- **Leftover-head check.** Per frame, the share of the original's skin pixels (eroded 5 px) that the composite left unchanged within 4 levels. On very dark
  footage small tone changes count as unchanged, so the result (20 to 39 percent on most frames) is an upper bound; always read it beside a strip.
- **Landmarks.** MediaPipe face landmarks (0.10.21, model file float16) find the face on the front-on frames only (0.2 s and 1.0 s here) and return nothing on
  turned, occluded or half-out frames.
- **Takes.** A segment that comes back unswapped is retaken with seed 21 and adapter strength 1.6; retaking a start 0.33 s early removed the unswapped
  first frames.

## Final state of the test clip (draft 4) and the last fixes

- **Collar tuck.** In bare-head mode remove from the mask every pixel where the original shows collar, cape or cowl fabric (blue minus red at least 11 and
  luminance at least 12, grown 2 px), then open the mask with a 9 px ellipse. The donor's skin then ends behind the original fabric edge and the jaw and
  neck outline is smoother. The outline in the last piece was still a little blocky.
- **Colour lock.** The LAB match (mean and contrast, per channel) is blended 25 percent new and 75 percent previous frame, reset at each segment start. This
  removes frame-to-frame brightness jumps and softens the steps at segment joins.
- **Recolour of leftover skin.** Any original skin pixel the donor did not cover keeps its light and shadow structure (luminance scaled 0.8 around the region
  mean) but takes the donor's skin tone (a and b channels). This is what remains for a head that the frame cuts off.
- **Canvas padding for a cut-off head failed twice.** Widening the canvas by 40 percent (352x448 for a 1512x1920 canvas, 66 GB) with the new area filled by
  edge smear gave a donor that copied the smear; filling by mirror gave a symmetric non-head. Neither drew a head. Do not repeat; use temporal extension from
  neighbouring swapped frames if this must be solved.
- **Keyframe-propagated mouth was not built.** It needs face landmarks on the original, and the landmark tool only finds the face on front-on frames. The
  flow-driven blend (step 10) is what keeps the mouth steady; the donor's own gentle mouth shape stays.
- **Final numbers.** Joined clip: 10.00 s, 1080x1920, H.264 yuv420p, AAC, 4.2 MB. Mouth flicker (original / before filter / after filter): 2.52 / 3.02 / 1.51,
  3.72 / 3.26 / 1.60, 3.62 / 6.19 / 4.89, 7.02 / 8.19 / 5.92, 6.54 / 8.01 / 5.67 for the five segments. Leftover-original-head check flagged 173 of 239
  frames at the 15 percent bound (an upper bound on dark footage).
- **Order of work that would have saved the most time:** crop references first; remove burned-in text from the guide; check each donor's PSNR against its
  guide immediately and retake before compositing; build the composite from skin gating first, add the bare-head mode last and late.
