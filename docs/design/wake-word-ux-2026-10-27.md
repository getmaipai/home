# Wake word UX (2026-10-27)

Decision record for WAKEUX-01. Owner-approved 2026-10-27 ("ok i agree with your design. build it"; on the corner thing: "should we combine the ear and companion always on thing so we have 1 thing", answered "The avatar shows listening").

**Supersedes** the HANDSFREE-01 acceptance line "toggling it from the composer and from the settings page moves the one same value": the composer toggle is gone (it looked like the microphone button), and the one setting is switched in Settings > AI and models > Wake word and from the indicator's Turn off.
**Supersedes** `companions-shared-chat-and-presence-2026-10-24.md` section 7 where it hides the launcher on Chat routes and shows no status: the avatar now shows the listening state on every page, Chat included (RULES S2).

## What the person sees

1. **Turning it on.** Settings, This device, "Wake word listening". Off by default, adult only, per device (HANDSFREE-01 invariants i, ii, v are unchanged).
2. **While it listens.** **Slice 1 (this one): Chat only.** The indicator stays where it is today; the shell-wide version waits for the kit Element (slice 2). Target: one indicator at the bottom corner of every page, Chat included: an ear icon, "Listening for Hey Jarvis" and a Turn off button on the indicator itself (invariants iii and iv). It is the companion launcher's listening state: when the launcher is built it takes the ear and Turn off rather than a second element, and it shows while listening even if the person turned the launcher off.
3. **Saying the word.** A short rising two-note chime, then the voice call opens in place on Chat. Slice 2: from any other page Chat opens with the call running.
4. **In the call.** The call overlay is the existing one. A wake-opened call closes by itself after 8 seconds with no speech, with a short falling chime; the overlay's settings link reads "Hands-free settings".
5. **Hidden tab.** A hidden browser tab stops listening and resumes when shown, so the microphone is never open in the background without the indicator on screen.

## Rules touched

Slice 2 needs a RULES.md S2 sentence for the shell-wide indicator and the kit Element first (architect 2026-10-27: rule 9b forbids a hand-built bordered box outside Chat; the owner approved a new ui tag the same day). The shared kit gets no new Element in this slice: the hand-built indicator stays until a `listening-indicator` Element exists in `commons` (reuse check: `status.tsx`, `launcher-bubble.tsx` and `connection-state.tsx` carry no microphone or off action, so none fits as is; the launcher bubble is the intended home once it ships, which is why the corner is shared).

## Slice 2 (WAKEUX-02)

Decision (owner, 2026-10-27, "Launcher shows listening"): the listening state lives in the existing kit `LauncherBubble`, not a new Element. It takes `listening` (the sentence), `onTurnOff` and `docked` (pins it to the bottom corner), shipped in `ui-v0.5.371` and `ui-v0.5.372`. The hook `useWakeWordListening` owns the microphone logic (adult and per-device gates, hidden-tab and live-call pauses) and returns the indicator props only while the mic is open. `Routes.tsx` draws the launcher on every page except Chat; `ChatPage` draws its own, because it owns the call. Only the active site reacts to a word, so Chat never fires twice. Off Chat the word plays the rising chime and navigates to `/chat?wake=1`; ChatPage reads the flag once, opens the call as a wake-opened call and removes the flag from the URL. RULES S2 carries the indicator sentence (Owner-approved 2026-10-27).
