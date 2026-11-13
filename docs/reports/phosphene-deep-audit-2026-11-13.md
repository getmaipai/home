# Phosphene deep audit and the picture Studio port (2026-11-13)

Follows [phosphene-parity-2026-11-13.md](../design/phosphene-parity-2026-11-13.md). Source: a read of the public Phosphene repository (MIT) by four
readers: performance, UI and layout, Images and Editor, and our own picture code. Nothing from the clone was run, so every Phosphene number below is
that project's own claim (mostly an M4 Max with 64 GB), not a measurement of ours.

## 1. The finding that changes the ask

Phosphene has **no editor for stills**. Its Images tab is a make form: pick a model, drop up to three reference pictures, describe the change in
words, get one to eight takes, then send a take back in as the next reference. It has no brush, mask, crop, adjust, background removal, expand,
upscale or compare for a picture. Those exist there only for video.

Home is ahead on editing and behind on reach. The kit already ships an `ImageEditor` (Markup with text, Comment by point or box, Remove background,
an Erase brush, Resize with 2x and 4x upscale, zoom, preview with Apply and Undo, versions, download, a phone layout). The backend registry already
runs remove background, erase, upscale, resize, crop, adjust, blur background and change in words. But the editor opens only from a picture in a
chat, and the six edit pages of the Images app are "coming soon" placeholders.

So the port is: put our editor on a page of its own, reachable from any Library picture, finish its missing tools, and take Phosphene's workflow
ideas around it. This is the Studio of [images-app-2026-11-03.md](../design/images-app-2026-11-03.md) (IMG-STUDIO-01, IMG-STUDIO-02, IMG-OPS-02);
no new design is introduced here.

## 2. What we take from Phosphene

### Workflow
1. **Edit this picture.** Any finished picture has one action that opens it as the thing being edited. Here: every Library picture opens in the Studio.
2. **Iterate.** A result becomes the next source without a trip through a file picker. Here: each Apply is a new version, and the next tool starts from it.
3. **Hand-offs fill a form and start nothing.** "Animate" opens the video form with the picture in place; nothing renders until the person presses Generate.
4. **Takes.** One to eight candidates per run (a Create feature; not part of this build).
5. **How it was made.** A read-only panel per output: words, model, quality, seed (later row).

### UI rules
1. A verb goes on the bar; a property stays in the inspector. The test is how many times an hour it is pressed.
2. A control disables and says why; it never disappears. The tooltip is the fix, and it ends with the shortcut.
3. One table of actions feeds the bar, the overflow menu and the right-click menu, so the three cannot drift apart.
4. Overflow moves the tail of a bar into a More menu; a bar never wraps to a second row.
5. Undo toasts instead of confirm dialogs for anything reversible.
6. One health chip names the worst problem; the detail is in a popover. (Ours: the RULES S6 health rows.)
7. Chips show three lines: the name, the size, then the wait, "unavailable", or the download size.

### Colours and type (recorded, not copied)
Phosphene is a near-black neutral app (page `#0a0a0b`, panel `#121214`, border `#2a2a2f`, text `#f4f4f5`) with one yellow focus colour and a
pink, violet and cyan gradient kept for the primary action, progress and the chosen state. Type is Archivo, Newsreader for empty states and
Fragment Mono for numbers. Home does not take fixed colours: every colour follows the person's theme tokens (owner rule, 2026-10-19), and the
Studio takes the studio token scope the Music and Video studios use. What carries over is the restraint: one accent, used only for the main action,
progress and the chosen state.

### Performance (for the Stack; none of it is Home code)
Ranked by the repo's own stated gain. Each is a candidate for a Stack bench row, not a claim about our engine.
1. Cap the MLX allocator cache (memory divided by 8, between 2 and 8 GiB), set again before every render. Stated: 25.5 to 16.5 GB peak, same output, same time.
2. Keep one pipeline warm, keyed on the set of LoRAs; exit the helper after 30 idle minutes.
3. Gate sizes and features by measured peak memory per machine tier, greyed with a reason.
4. Tiled VAE decode with a budget that scales with memory, and a guard for the Metal 2^31 element limit. Stated: 16.97 to 7.78 GiB peak on a long clip.
5. Step-distilled schedules (5+2 instead of 8+2 steps, 13 percent faster).
6. Free the generation modules before decode; report "done" before teardown.
7. Sliding windows with a carried tail for long clips (flat memory).
8. Time estimates from a cost model, a table of measured runs, and self-calibration on the install.
9. TeaCache and first-block cache for image models (stated 1.2x to 1.4x, about 28 percent at 8 steps).
10. Streamed transformer blocks and a split prompt encode for 16 GB machines.

## 3. What we do not take
- The fixed palette and fonts (theme tokens instead).
- The Ideogram layout canvas (a new kit element and a model we do not run; its own row if wanted).
- Phosphene's video editor timeline (the Video Studio already covers it).
- MCP server, Pro tier, analytics, social links.

## 4. Build (this pass)

| Slice | Repo | What |
|---|---|---|
| A | commons | `image_editor` page node in spec; kit `ImageEditor`: Crop with aspect presets, rotate and flip; Adjust sliders; before and after Compare; a brush on Comment that sends a mask; a data-driven `operations` prop |
| B | Home backend | Library-file addressing for picture operations (today a 501), versions for Library pictures, rotate and flip operations, the edit route accepts crop, adjust and blur background, an action host for the Images app |
| C | Home | pin the new tags, bind the node, a Studio page, the six placeholder pages open the Studio on their tool, "Edit" on a Library picture |

Gates are unchanged: the registry's own age, lane and photo-upload gates run on every call, and a locked adult-only picture is refused with the
existing line until ADULT-LOCK-07 lands.

Not in this pass: expand canvas (needs an engine bench first), Create with takes and templates (IMG-UI-01), the "how it was made" panel.
