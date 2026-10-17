# Image editor tools: remove background, erase, upscale, resize (2026-10-17)

Owner approved the ChatGPT-style editor (Edit button on a picture in chat, opens in the canvas) on 2026-10-17. This note covers the
non-generative tools only: Remove BG, Erase, Resize and upscale, plus the Stack API they share. Markup, zoom, download and share are
client-side; Comment (a described change) is the generative edit model, designed elsewhere. Every number below was measured on the
Studio (Apple M5 Max, 128 GB), CPU provider, with the live Stack running (load average 15 to 20, so times are upper bounds).
Bench scripts, test images and every output are in the author's scratchpad (`scratchpad/imagetools`, sample paths in section 6).

## 1. Picks

| Tool | Pick | Licence | Speed (1024 / 2048 px picture) | Peak memory | Why |
|---|---|---|---|---|---|
| Remove background, Mac | **Apple Vision foreground mask** (`VNGenerateForegroundInstanceMaskRequest`) through a 70 KB Swift helper | OS API, no model, no download | 0.21 to 0.57 s including process start | under 100 MB | Fastest by 10x; kept whole scenes, people, robots and helmets cleanly in every test; no weights to pin |
| Remove background, everywhere else and fallback | **IS-Net general use, ONNX** (`imgly/isnet-general-onnx`) | MIT on the card, Apache-2.0 upstream (DIS) | 0.8 s / 0.8 s (+0.1 s edge colour pass) | 3.2 GB | 176 MB, runs anywhere onnxruntime does (robot, Linux); fails on some multi-subject art (ghosted robot in one test) |
| Erase (inpainting) | **Big-LaMa, ONNX** (`Carve/LaMa-ONNX`, fp32) | Apache-2.0 | 2 to 4 s (hole crop resized to 512, filled, blended back) / 1.3 to 2.6 s | 1.7 to 1.9 GB | Removed a spoon from a photo cleanly; OpenCV Telea left smears. Model input is fixed at 512, so a big hole on a 2048 picture is filled at lower detail (row IMGTOOLS-07) |
| Upscale | **Real-ESRGAN general x4v3, ONNX** | BSD-3-Clause | 2.7 s for 1024 to 4096 (x2: 2.9 s, x4 then area downscale) | 1.4 GB | 4.9 MB model, sharper than Lanczos on art and photos |
| Downscale and exact resize | **Lanczos / area** (OpenCV) | none | under 0.2 s | small | Nothing to learn |

Optional later "best" engines, not in slice 1: BiRefNet-lite (MIT, 2.6 s, but **11.5 GB** peak on CPU: its deformable convolutions do not
compile for Core ML, so only p64 and p128 could host it) and Real-ESRGAN x4plus (39 s for 1024 to 4096, 3.5 GB).

### Measured bench (remove background, 18 images, CPU, whole-run averages)

| Engine | 1024 s | 2048 s | Load s | Peak MB | Notes from opening the outputs |
|---|---|---|---|---|---|
| Apple Vision | 0.25 | 0.30 | 0 | small | Best on illustrations and photos; plant strokes ragged; one grass image found no subject (the helper exits 5 and the service falls back to IS-Net) |
| BiRefNet full | 5.6 | 5.1 | 2.7 | 16,628 | Picks the main subject (drops furniture, rug); clean edges |
| BiRefNet lite | 2.6 | 2.5 | 1.1 | 14,533 (11,550 with arena off) | Same behaviour, slightly rougher |
| InSPyReNet | 4.1 | 4.2 | 0.5 | 7,660 | Keeps backgrounds; semi-transparent patch on a helmet |
| IS-Net general | 0.8 | 0.8 | 0.1 | 3,220 | Good; one ghosted subject |
| U2Net | 0.3 | 0.3 | 0.1 | 2,568 | Worst; rejected |

IoU against the flattened art's own alpha is reported in the scratchpad results but is not a pick criterion: the art's alpha is the whole
vignette, while salient-object models (BiRefNet, IS-Net) correctly keep only the subject. Edges on hair and fur: the only public-domain
photos available offline are 300 to 512 px, so hair edges were judged on upscaled files and all engines were equal there (not a real hair
test; a licensed high resolution portrait set is a follow-up, IMGTOOLS-09). Glass: no engine produced fractional alpha for a translucent
goblet (all kept it as a light opaque shape); stated as a limitation, not solved. Fur and plants: grass blades kept by all but U2Net.

### Rejected on licence or fit

BRIA RMBG-2.0 and RMBG-1.4 (CC BY-NC, non-commercial), MAT inpainting weights (non-commercial), anything research-only, SAM-based matting
(needs a prompt per click, no gain over the helper for "remove the background"), MODNet (portraits only), SD inpainting (the generative
agent's lane). Swin2SR was not benchmarked past loading (53 MB, Apache-2.0): Real-ESRGAN is the proven pick.
Face note: at 128 px input both upscalers visibly redraw faces. Upscaling invents detail; the editor says so on the Upscale control.

## 2. Runtime

One managed Python 3.12 environment, `image-tools` (onnxruntime 1.31.0, numpy, pillow, opencv-python-headless, no torch; about 250 MB;
hashed requirements, the same uv builder as the voice engines and ddgs). One worker process speaks JSON lines on stdin and stdout (no
port). It starts on the first edit, keeps its model about 120 s (an erase session paints many strokes), then exits and returns its memory.
Models load one at a time. While the worker lives it holds one pinned governor admission of 4 GB; a refusal is a plain 503 telling the
person what to do. Apple's helper (`fgmask.swift`) is compiled once with `swiftc` when the Mac has the command line tools; where it
is not, IS-Net does the job. Follow-up: ship the compiled helper as a signed release asset so no compiler is needed (IMGTOOLS-08).
Core ML was tried for the heavy models: not usable (BiRefNet fails to compile). ONNX CPU is fast enough for the three picks.

## 3. API (additive; Stack contract number unchanged)

- `POST /v1/images/edits`, multipart: `image` (required, 40 MB), `operation` = `remove_background` | `erase` | `upscale` | `resize`, `mask`
  (erase; white is removed; resized to the picture if sizes differ), `scale` (2 or 4), `width` and `height` or `factor` (resize), `engine`
  (`auto`, `vision`, `isnet`), `timeout_ms`. Answers like `/images/generations`: 200 `{ created, job, data:[{ b64_json, width, height,
  content_type, operation, engine, model, ms }] }`, or 202 with the job id past `timeout_ms`. Errors: 413 too big (the limit in words), 422
  cannot be done (empty mask, no subject, bad scale), 503 not installed or no free memory, 500 failed. Each has `error` (what happened and what
  to do) and `code`.
- `GET /v1/images/edits/{job}`: the PNG, held in memory about 10 minutes (six newest), never on disk or in a log.
- `GET /stack/v1/image-tools`: `{ state, phase, vision, models:{isnet,lama,esrgan}, limits, operations }` for Home to enable each tool.
- Limits (megapixels): remove background and erase 25 in; upscale 6 in and 36 out (so 4x tops out near 1500 px square, 2x near 2400); resize 36 out.
- Time budgets: 2 minutes for remove background and erase, 5 for upscale, 1 for resize; past the deadline the worker is stopped and the person told.

Home owns the routes people and the canvas call (rule S2 area, age and surface gates), calls the Stack through its client, and stores the result as
a new picture version. The Stack is only ever called by Home.

## 4. Per-tier availability

The three models total 389 MB; the worker's peak is the largest single model (about 3.5 GB). They are in the install plan for every tier
that has a plan and are used wherever the governor admits 4 GB at the first edit (p16 refuses while a heavy chat or a render holds memory, with a message).
p32, p64 and p128: always. The robot is complete without a hub: its own tools service is a later port (same worker, no Apple helper).

## 5. Safety posture and rules check

- The tools act on a picture the person already has. They make no choice about who is in it; no identity, face or age feature exists in them.
  Age and surface gates are unchanged and stay in Home, which decides who may open the editor and call the route (rule 0). Nothing here
  generates imagery of a real person.
- Output is a fresh PNG: EXIF, GPS and colour profile are dropped; orientation is applied first.
- Privacy: nothing leaves the home. The only outbound fetches are the existing pinned downloads and the environment build (privacy rows updated).
  No picture, mask or result is logged (rule 6a: no activity text in logs; the worker reports only operation, size and milliseconds).
- Rules: 1 (the model decides), 2, 3, 4, 5, 10 and 13 govern the chat turn and do not apply to a tool the person clicks. Rule 9 and 9b bind the
  editor UI: it must be kit Elements and shadcn primitives with no overrides; an image editor canvas is a named gap (IMGTOOLS-05 records it in the
  elements adoption list before any code). Rule 11: only Stack-installed, pinned components run. Rule 8: nothing gated on a model id; tools follow the status route.
- Self-review against RULES.md: no conflict found. The architect agent was not available to this session; verdict still owed (IMGTOOLS-02 carries it).

## 6. Samples (author's scratchpad, `scratchpad/imagetools`)

`out/bg/<engine>/*.png` (cut-outs per engine), `out/erase/*_lama.png` and `*_telea.png`, `out/up/*.png`, contact sheets `out/sheet_*.png`, end-to-end
outputs through the real Stack route in `e2e/`.

## 7. Slices (rows are in `docs/BACKLOG.md`)

| Row | What |
|---|---|
| IMGTOOLS-01 | Stack: tools service, worker, pins, install plan, `/v1/images/edits`, status route, tests. **Built and landed, Stack `b8a0ea9`**; verified end to end on a scratch Stack (own data dir, port 8793) with real images: Vision cut-out 0.6 s, IS-Net 2.5 s at 2048 px, erase 1.5 s warm (6.8 s with model load), upscale 2x of 1024 px 4.4 s, EXIF stripped and orientation applied, empty mask 422, oversize 413. The STACK_TAG pin bump is not done |
| IMGTOOLS-02 | Architect verdict on this note, then Home endpoints |
| IMGTOOLS-03 | Home: `POST /api/images/:id/edit` calling the Stack, new picture version, gates |
| IMGTOOLS-04 | Home: tools status wired to the editor's enabled state |
| IMGTOOLS-05 | Canvas editor UI: Remove BG, Erase (brush mask), Resize; elements-adoption entry first |
| IMGTOOLS-06 | Tests: Stack worker real-image tests, Home route tests, browser flow with a real image |
| IMGTOOLS-07 | Erase on large holes: tiled second pass at native resolution |
| IMGTOOLS-08 | Compiled Apple helper as a release asset; Linux requirements file |
| IMGTOOLS-09 | Hair, fur and glass test set from licensed or public-domain high-resolution photos; BiRefNet-lite option for p64 and p128 |
