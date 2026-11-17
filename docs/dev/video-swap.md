# Swap character (CREATOR-57)

One cast member replaces the head of the person in a finished clip, on the Stack's `h3-swap` engine.

- Stack route: `POST /v1/videos/swap`, then `GET /v1/videos/swap/{job}` for progress and `.../video.mp4` for the result. The Stack reports `qualities.h3_swap` (`ready`, `sizes`, `peak_gb`). Home treats a missing route or `ready: false` as "not available on this computer yet".
- Runner: `lib/videos/stackSwap.ts` stages the clip, sends the cast photos as multipart, polls, and reads the result back. It mirrors `runStackEdit` and plugs into `startVideoEditJob` as an `EditRun`.
- References: `lib/videos/swapReferences.ts` takes the cast member's ordinary photos in stored order (the loader already leaves out generated sheets), at most three; the first is the face.
- Tool: `edit_video` change `swap` with one cast id, optional `from_s` and `seconds` (at most 10 s). Adults only, Max only, never in a temporary chat. The size is 512x384: 640x480 needs 112 GB of GPU memory, more than the 110 GB limit.
- Page: `packages/video/pages/swap.json`, started through `lib/videos/swapStart.ts` and `POST /api/plugins/video/actions/swap`. The Library row menu is full (the kit allows three row actions), so the page is reached from the Edit list.
- The tool schema for `edit_video` is at its size ceiling (6200 characters), so the swap arguments are terse and the person's name is the description.
- Not shipped on the live Stack yet: the Stack needs the swap route and the engine installed first.
