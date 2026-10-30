# Making space: what we can free, what we must not do, the one easy settings page, and the setup wizard (2026-10-30)

Status: proposed, not decided, not built. Item ids MEM-SPACE-01 to 06. Extends [resource-profiles-2026-10-30.md](resource-profiles-2026-10-30.md)
(the live-fit ladder, section 3b), [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) and
[memory-management-2026-10-25.md](memory-management-2026-10-25.md) (section 10 already researched the SSD). Owner's ask (Jesse, 2026-10-30): research
whether killing processes, deprioritizing them, offloading to the SSD and similar can give us more room when we need it; make the settings for all of
this very easy to use; and account for it in the first-run setup wizard that installs the models.

## 1. Answer

1. **Yes, but the useful room is mostly in a short list of cheap moves, and three popular ideas are wrong for this machine.** Cheap and worth doing:
   trim idle timers to the owner's 2-minute grace when a bigger job is waiting, clear framework caches, tell the person what else on the Mac is using memory, and run Home's own
   CPU-only side work at background priority. Wrong: using the SSD as extra memory (swap), pausing a worker with a stop signal, and force-purging the
   file cache.
2. **We never kill a process that is not ours.** We stop only processes Home started, by the pid we recorded (owner rule 2026-10-21, a broad pattern
   once killed other sessions' work). For anything else we show what is using memory and ask the person to close it.
3. **Reclaiming has an order, cheapest and least noticeable first,** and it is the "clear waste first" step of the live fit (profiles note 3b), now
   spelled out in section 3.
4. **One settings page, three presets, no numbers on the first view** (section 5). **The setup wizard shows what this Mac can do per tier and downloads
   only what fits** (section 6).

## 2. Research: what others do, and what holds on this Mac

| Idea | What the sources say | Verdict |
|---|---|---|
| Offload to the SSD as memory (swap, mmap on demand, weight streaming) | Measured here in the memory note section 10: SSD reads 12.4 GB/s against 614 GB/s memory; a dense model streamed per token falls under 1 token per second; swap writes wear the drive. Nothing new found. | Rejected again. The page cache already is the SSD offload: an unloaded model reloads in 1 to 2 s per 12 GB, which is why aggressive eviction is cheap. |
| Lower priority for a process: `renice`, `taskpolicy`, QoS ([Eclectic Light on QoS](https://eclecticlight.co/2022/01/07/how-macos-controls-performance-qos-on-intel-and-m1-processors/)) | On Apple silicon a process can be pushed to the efficiency cores as background QoS, and background I/O can be throttled. Neither frees any memory. | Adopted for Home's own CPU-bound side work only (embeddings, transcoding, stem splitting prep, indexing). Not a memory tool, and the GPU has no priority control, so for GPU jobs the heavy gate (pause for chat turns) stays the tool. |
| Jetsam bands and per-process memory limits ([XNU memorystatus notes](https://cs.iossec.tech/xnu/latest/source/doc/vm/memorystatus.md)) | macOS ranks processes into bands and can limit a process softly (early kill candidate) or hard (killed when crossed). Mostly an iOS and daemon mechanism. | Rejected as a tool we drive: we do not set limits on other apps. Our governor is the limit, set before a model loads. |
| Suspend a worker (`SIGSTOP`) to "pause" it | The memory stays allocated; under pressure macOS may compress or swap those pages, which writes to the SSD. | Rejected. Unload and reload (cheap through the page cache) or drain; never freeze a model-holding worker. |
| Force-purge the file cache (`purge`) ([overview](https://www.docs.rs/crate/ruvector-memopt/latest/source/src/macos/memory.rs)) | Needs root; macOS already reclaims cache on demand; purging makes the next minutes slower. | Rejected as routine. It also deletes the page cache that makes model reloads cheap, which the memory note forbids. |
| Shrink the chat model's context or quantize the KV cache | Third-party MLX forks report that 4-bit key quantization breaks greedy decoding; the savings in most schemes are theoretical, not measured resident memory ([VeloxQuant notes](https://pypi.org/project/VeloxQuant-MLX/), [turboquant-mlx](https://github.com/arozanov/turboquant-mlx)). Only token eviction cuts resident memory. | Rejected for chat: RULES.md rule 4 keeps the full context window, and the engines that run are our own tested set (rule 11). Revisit only as a measured Boost-tier option. |
| Show the person what is using memory and let them choose ([LM Studio's per-model fit estimate](https://www.lmstudio.ai/docs/system-requirements) is the nearest shipped pattern) | LM Studio estimates fit per model and recommends rather than enforces. | Adopted: estimate per tier before download and before a job, say plainly, ask rather than force. |
| Smaller or lower-precision models as the way to fit | Already the tier ladder and the live-fit step down. | This is the main lever; nothing new needed. |

Not verified: how Jan and Msty size models on first run (no sources found); whether an upstream `mlx-lm` rotating cache would be safe for chat (only forks found).

## 3. The reclaim ladder (the "clear waste" step of the live fit)

Home's household queue asks for room; the Stack governor does the moves it already owns. Each step stops as soon as the need is met, and each is
reported on the job's record so the status line can say what happened.

| Step | Move | Cost to people | Notes |
|---|---|---|---|
| R0 | Clear MLX buffer caches after each job; unload finished burst workers | none | Already in the memory note (slice 4). |
| R1 | **Apply the owner's grace when a bigger job waits.** The picture pool idles out at 10 minutes; owner answer 3 of 2026-10-25 lets it be evicted once idle past 2 minutes when a job needs the room. R1 only makes sure the queued job triggers that existing rule | none (next picture reloads in 6 to 12 s) | Existing owner rule; no new value.  |
| R2 | Evict idle warm models in the memory note 4.3 order | none to a few seconds on the next use | Existing. |
| R3 | Lower other categories per the profile table (chat Reduced, etc.) | chat gets simpler for the job's length; quiet window and 10-minute rule apply | Profiles note 3b step 4. |
| R4 | **Ask the person to close big apps.** The Stack's existing dev-load reading (`devProtection()` in `memoryWatchdog.ts`, the `memory.dev-load` event, memory note 4.2) already finds what else is using memory. It feeds the Status page's whole-system row for admins, using the existing "something else is using it" card wording: "Another app is using 9 GB. Closing it gives the video room to run at Max." | none unless they choose | No new reader. App names reach admins on the Status page only, never a person's card (RULES.md 6a), never logged or sent. We never close an app ourselves. |
| R5 | Step the job down a tier (live fit step 4c) and ask first | the job is lower quality | Existing in profiles note. |
| R6 | Queue or refuse with numbers | wait | Q1. |

Never done on purpose: swap, SSD streaming, stop signals, cache purges, killing foreign processes, raising the GPU wired-memory limit (memory note 2).

**Background priority for Home's own CPU work (MEM-SPACE-02).** Workers that do no inference (embedding batches, transcodes, indexing, stem prep)
start at background QoS with throttled I/O, so a chat turn on the same cores never waits behind them. This is about speed, not memory, and it is
honest in the copy ("runs in the background"), not in any memory number.

**The Studio is not the product.** This Mac also runs build sessions and benchmark engines beside the live engines (the 2026-10-21 incident). That is
a coordination rule for our sessions (check free memory, one extra model at a time, pause during live jobs), already in the working rules; the
shipped product only has to handle other apps on a household's Mac, which is R4.

## 4. Where the numbers come from

Free memory, the ledger, and the pressure level come from the Stack watchdog's existing readings (`kern.memorystatus_level`, the compressor pages,
`host_statistics64`). The other-apps reading (R4) is the Stack's existing dev-load reading; Home adds no process-list reader and no poller.

## 5. Settings that are easy to use

One page: **Settings > AI and models > Performance**, drawn as data by `SettingsShell` with shipped kit controls (rules S4 and 9). Only admins
see this page.

1. **No status strip of its own (rule S6).** Status reaches people through the two existing mechanisms: the per-category Status row (TIER-HOME-03,
   `statusApps` and `roleHealth`) and the "Pictures and video are not ready" row fed through `healthSnapshot` with the watchdog `cause`. This note only
   adds reasons and copy to them: "Home has room for a big video right now", "A big video would make chat simpler for about 12 minutes", and for admins
   "Another app is using 9 GB; closing it lets videos run at Max".
2. **Three presets, one choice** (the whole policy set in one tap; the tiers and priorities notes supply every value):

   | Preset | What it does in a parent's words | Underlying values |
   |---|---|---|
   | Chat first (default) | "Chat always answers. Big jobs wait for a quiet moment." | quiet window 60 s, wait 10 minutes then go ahead, ask before lowering a job, chat stays Standard unless a Max job needs room |
   | Balanced | "Big jobs may make chat a little simpler while they run." | quiet window 20 s, Reduced allowed for Boost and Max, lower without asking for pictures |
   | Big jobs first | "Get the best quality; chat gets simpler while it runs." | quiet window 20 s (the minimum, S1), Reduced allowed, lower without asking off, Max jobs start as soon as room can be made |

   The preset is one setting (`resources.preset`); the values it implies are written once in the settings spec. **Precedence:** a preset sets defaults; a
   field changed in Customize overrides that one value and the page then reads "Custom" instead of the preset name, so no value is defined twice.
3. **The per-category switches stay on AI and models (TIER-HOME-04, S4: each group in exactly one card).** The Performance page links to them in one
   sentence ("Turn Boost or Max on or off per job on the AI and models page") and does not repeat them.
4. **A "Free up memory" button** that lists what it would do ("Unload 2 idle models, about 14 GB. Other apps could free about 9 GB more; see System status")
   and does only the Home-owned part when pressed. It is separate from the disk "Free up space" button of the AI models page, and the label says memory.
5. **"Customize" opens the advanced view, and it is the new home of the Resources > Priorities panel** of the profiles note section 7 (TIER-PRIO-02 is
   built there, not as a separate panel): the priority list (drag), the profile table, the quiet window, `lower without asking` per category. Every
   field there states its effect first. Nothing on the first view is a number or a model name.
6. **Rules:** the page never shows a raw error (a pause is a waiting state, rule S6); a child or teen cannot reach it; a change that cannot fit is
   refused with the roles to turn down named (as SETUP-SIZE-01 does).

## 6. The setup wizard

The wizard already has the disk plan with sizes (INSTALL-DISK-01), the sizing page with step-down (SETUP-SIZE-01) and the job cards (AIMODELS-SETUP-01).
This note adds what is missing: the tiers and the memory behaviour.

1. **Measure this Mac first.** The existing hardware step reports memory, free memory with the operating system's own use taken out, and disk. It now
   also reports the machine class the tiers note section 4 uses.
2. **Show what this Mac can do, in plain words, before any download.** A short table built from the same slot and profile tables the app uses: per
   category, which of Standard, Boost and Max this Mac can run (`fits_ever`), and what it costs: "Videos: Standard yes, Boost yes, Max not on this Mac
   (needs 80 GB). Pictures: all three. While a Max picture runs, chat gets simpler." Greyed rows say why, never hidden.
3. **Download only what fits.** Boost and Max models are offered with their size only when they can ever fit; a tier that cannot run here is never
   downloaded, so no disk is wasted. The Reduced chat model is the judge model that is already resident in the standard profile, so it adds no download.
4. **Pick the preset and the starting tiers,** defaulting to Chat first with Standard and Boost on and Max left to the admin after setup. The summary
   line: "Total download 62 GB. Chat stays fast. Big pictures and videos may make chat simpler for a few minutes."
5. **Small Macs say it straight.** On a class with room for only one big model at a time, the page says "Videos will wait while pictures run" and
   shows the shorter ladder, not a broken promise. Collapsing tiers is the tiers note's per-class table, not new logic.
6. **The wizard extends SETUP-SIZE-01's page, and Settings shows the same page.** SETUP-SIZE-01 already plans "the same page under Settings"; the
   capability table is a kit Table drawn with data (a missing control is a kit change in `commons` first, rule 9c), not a new component
   (platform principle 4).
7. **After setup, the same table is what the AI and models page edits,** so a person who skipped Max at setup can turn it on later without
   re-learning anything.

## 7. Proposed rows (evaluations first where a number is unknown)

| Row | Slice | Done when |
|---|---|---|
| MEM-SPACE-01 | R1: a queued job that does not fit triggers the existing 2-minute pool grace; reclaim steps reported on the job record | Test: a queued job that does not fit evicts a pool idle past 2 minutes and not before; the status line names the step |
| MEM-SPACE-02 | Background QoS and throttled I/O for Home's CPU-only workers | Measured: a chat turn's first-token time with an embedding batch running is within 10 percent of idle |
| MEM-SPACE-03 | R4: feed the Stack's dev-load reading into the Status page's whole-system row for admins, with the existing card wording | Admin sees the other-apps line; no new reader; nothing is logged or sent; no process is signalled |
| MEM-SPACE-04 | Performance page: presets (`resources.preset`), Free up memory, Customize (absorbs TIER-PRIO-02's panel); new reasons and copy on the existing status mechanisms | Screenshots opened and judged at both widths; every control states its effect |
| MEM-SPACE-05 | Wizard: machine class and capability table, tier-aware plan, presets | Run on the dev Mac and a simulated 36 GB class: the table is right and unfit tiers are not downloaded |
| MEM-SPACE-06 | Capability table as a kit Table on SETUP-SIZE-01's page, the same page under Settings | One page, one source of numbers; lint shows no second copy |

Order: 01 and 02 independent; 04 after the tiers rows that define the switches (TIER-HOME-03/04); 05 and 06 after SETUP-SIZE-01; 03 any time.

## 8. Reuse check

Prebuilt options considered: macOS `taskpolicy` and QoS for background work (adopted, nothing to build beyond a launcher flag); `memory_pressure` and `host_statistics64`
for readings (already used); LM Studio's fit estimate pattern (adopted as copy); oMLX and llama-swap for loading mechanics (covered in the profiles note 8a). No
library gives a household-friendly settings page; it is drawn as data by `SettingsShell` with shipped kit controls, and a missing control is a
kit change in `commons` first (rule 9c). Built on: the Stack governor and watchdog (including `devProtection()` and the `memory.dev-load` event for R4), `householdQueue.ts`, the settings registry, SETUP-SIZE-01 and AIMODELS-SETUP-01.

## 9. Rules check

Rule 8 (minors): no tier or reclaim step raises a minor above a ceiling; children and teens cannot reach the page. Rule 4: nothing shrinks chat context.
Rule 6a: app names reach admins on the Status page only (memory note 4.2), never a person's card, and are never stored or sent. S6: no new strip, banner or poller. Rule 11: no engine outside the Stack's tested set. S4 and 9:
the page is data and kit controls as shipped. S6: states only, no raw errors. Owner rules: never swap the chat model; never kill by broad pattern.

## Supersedes

Nothing owner-decided is overridden. Changes to decided text:

- Memory note owner answer 3 (2026-10-25: the picture pool is evicted only after 2 idle minutes) stands; R1 only makes a queued job trigger it.
- The profiles note S1 minimum quiet window (20 s) stands; the "Big jobs first" preset uses exactly the minimum.
- The profiles note section 7 "Resources > Priorities" panel moves into the Performance page's Customize view (one home, S4); TIER-PRIO-02 is built there.
- The preset writes defaults for `quiet_seconds`, `quiet_max_wait` and "lower without asking"; a Customize change overrides one value and the page shows "Custom". The profiles note defaults (60 s, 10 minutes, ask) equal the Chat first preset.
- Tiers section 3a rule 7 switches stay on AI and models (TIER-HOME-04); this note adds none.
