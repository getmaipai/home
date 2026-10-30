# Auto-close apps: MaiPai quits other apps on this Mac to make room, with lists and exceptions (2026-10-30)

Status: proposed, not decided, not built. Item ids MEM-SPACE-07 to 12. Owner's ask (Jesse, 2026-10-30): let MaiPai close non-MaiPai apps such as
Safari and Firefox automatically; an on and off switch; exceptions such as "never close Claude or Terminal"; or the safer shape, an "always close
these" list that includes the built-in Mac apps (browser, Maps, Messages, Music and so on). Extends [making-space-2026-10-30.md](making-space-2026-10-30.md)
(step R4 there only asked the person to close an app) and the live-fit ladder in [resource-profiles-2026-10-30.md](resource-profiles-2026-10-30.md) section 3b.

## 1. Answer

1. **Yes, as an opt-in feature that is off until an admin turns it on.** It is the "Close apps for big jobs" setting with two modes: **Off**
   (default) and **Automatic** (only for apps on the Always close list). There is no approval step: the list is the pre-approval (owner, 2026-10-30:
   a per-close approval would take too long).
2. **The safe shape is a list of apps to close, not a list of exceptions.** Home closes only apps on the **Always close** list. A **Never close**
   list wins over everything, and a built-in floor of apps can never be closed by any setting (section 4). "Close anything big except these" does not exist.
3. **Quit, never kill.** Home sends the app the same polite quit request the app's own Quit menu sends. An app with unsaved work shows its save
   prompt and stays open; Home leaves it and moves to the next step. There is no force quit, no `kill`, no signal, ever.
4. **It is a step of the live fit, not a background cleaner.** It runs only when a job needs room that the cheaper steps cannot find, closes only
   as many listed apps as the shortfall needs, and brings them back when the job ends.

## 2. Research

| Source | What it shows | Use |
|---|---|---|
| [Apple, `NSRunningApplication.terminate()`](https://developer.apple.com/documentation/appkit/nsrunningapplication/terminate()) | A normal quit request; may return before the app exits, so the caller watches `isTerminated`. Sandboxed apps cannot call it. | The mechanism: a small non-sandboxed helper running in the logged-in person's session. |
| [Apple forums on quitting other apps](https://developer.apple.com/forums/thread/768174) | Apple Events entitlements to control other apps are reviewed and often refused in the App Store. | Home is not an App Store app; it is installed by the person like any user (the Studio install flow). |
| [Razer Cortex Game Booster](https://www.razer.com/cortex/boost) and its [forum on exclusions and restore](https://insider.razer.com/razer-cortex-39/how-do-i-whitelist-a-service-or-program-to-stay-active-when-game-booster-kicks-in-27742?postid=123223) | The closest shipped product: stops background apps when a game starts, restores them when it ends. Users asked for a true exclusion list and complain restore sometimes fails or reopens what they did not want. | Adopted: close at job start, restore at job end, with a visible list. Lesson: make exclusions a first-class list (ours wins over everything), and make restore a per-app choice. |
| MEM-SPACE-07 measurements (2026-10-30, Mac Studio, partial) | Run as a real user LaunchAgent (`launchctl bootstrap gui/<uid>`), non-sandboxed Swift tool, `NSRunningApplication.terminate()`: TextEdit quit in 0.1 to 0.3 s, Pages in 0.1 s, Music (about 300 MB resident) in 1.0 s; osascript `quit` on TextEdit in 1.5 s. No consent prompt appeared for `terminate()` from the LaunchAgent. The caller's Automation consent for osascript was already granted on this Mac, so the osascript prompt is unmeasured. A test tool that polls `isTerminated` without running the run loop never sees the app exit, so the helper must run a run loop. | Mechanism works from a LaunchAgent. Still unmeasured, see section 7. |

## 3. How it works

1. **Trigger.** The live fit (profiles note 3b) has tried clearing waste and the idle grace, and the job still lacks room. The helper (section 6) reports the size of each
   running app on the lists. (The Stack's `devProtection()` fires only for one outside process over 40 GB or a sum over 30 GB, so it cannot size a 9 GB browser.) If closing apps from the Always close list would cover the
   shortfall, the ladder takes this step; if it would not, nothing is closed (no closing apps for nothing).
2. **Order in the ladder.** This step comes **before lowering chat** (it costs the Mac's own user an app, where lowering chat costs the whole
   household), and after the free steps. With the mode Automatic it replaces the old R4 "ask the person to close it"; with the mode Off R4 is unchanged.
3. **Pick the smallest set.** Biggest listed apps first, only as many as cover the shortfall.
4. **Never the app being used.** The frontmost app and any app the person used in the last 2 minutes are skipped. An app that is playing sound, recording or in a call is skipped if the system exposes that.
5. **Quit politely, wait, report.** Send the quit request, wait up to 20 seconds per app. An app that is still running (a save prompt, or it refused)
   is left alone and reported: "Safari asked to save, so I left it open". Home then continues to the next step of the ladder.
6. **Say what happened.** On the job's own card and the Status page for admins only: "Closed Safari and Music to make room (about 9 GB). They reopen
   when the video is done." No app name ever shows on a non-admin's screen (rule 6a).
7. **Restore.** When the job ends, Home reopens the apps it closed, once, by bundle id, in the order it closed them; macOS puts their windows back.
   A per-app **Reopen when done** switch (default on) lets an admin turn restore off for an app. If the person quit or opened the same app meanwhile,
   Home does nothing for it.
8. **Record.** App names are kept in Home's memory for the life of the job only, because restore needs them, and the admin's Status row reads them
   live while the job runs. The job record stores counts and bytes only ("closed 2 apps, about 9 GB"), so no app name sits next to a person's
   job (rule 6a). Nothing is sent anywhere (zero phone-home).

## 4. The lists

- **Never close (the floor, not editable):** Finder, Dock, loginwindow, SystemUIServer, System Settings, Activity Monitor, Software Update and
  installers, backup tools (Time Machine), every remote-access tool (Screen Sharing, Remote Management, Tailscale, the SSH server and common
  remote desktop apps), and all of MaiPai's own processes. These protect the household from locking itself out of the Mac.
- **Never close (editable, ships filled):** Terminal, iTerm, Claude, Claude Code, Xcode, VS Code, Cursor and other editors and terminals; password
  managers; anything an admin adds (a picker lists the running apps by name and icon).
- **Always close (editable, ships empty and offered as a one-tap starter):** Safari, Chrome, Firefox, Edge, Brave, Arc, Maps, Messages, Music, TV,
  Podcasts, News, Books, Photos, Stocks, Home, FaceTime, Mail, Calendar, Notes, Reminders, Preview, Keynote, Pages, Numbers. The starter is a list the
  admin reviews and confirms; nothing is closed from it until the mode is Automatic.
- **Precedence:** floor, then Never close, then Always close. An app on both lists is never closed.

## 5. Settings (very easy, on the Performance page)

One card on the Performance page of the making-space note, admins only: a single two-way switch (**Off, Automatic**), and under it
two plain lists, **Always close** and **Never close**, each with an "Add an app" picker and a one-tap "Use the starter list". Each app row has a
**Reopen when done** switch. Every change shows its effect first ("Safari will be closed when a big video needs room, and reopened afterwards").
Presets do not turn this on: the three presets leave it Off, because it touches the Mac's own user.

**Setup wizard.** One question, only when the Mac looks like it is also used as a regular computer (a signed-in desktop session with a browser or
other listed apps installed): "Is this Mac also used for other things? Home can quit apps like Safari when a big job needs room." Answers: Not now
(default) or Automatic with the starter list (shown for review and confirmed with one tap). A dedicated hub never sees the question. The wizard also asks for the one permission the
helper needs, with a test on a harmless app, and keeps the feature off if the permission is refused.

## 6. Pieces

- **Helper.** A small signed, non-sandboxed program installed with Home and run by a LaunchAgent in the logged-in person's session (a background
  service has no access to the person's apps). It is the **one reader of running apps** (names and sizes) and exposes only: list running apps with size, quit by bundle id, reopen by bundle id. Home's backend
  talks to it over a local socket owned by the same user. It refuses any request for a bundle id on the floor list, whatever the caller says.
- **Home.** The setting (`resources.close_apps.mode`, `.always`, `.never`, `.reopen`), the ladder step, the copy.

## 7. Proposed rows

| Row | Slice | Done when |
|---|---|---|
| MEM-SPACE-07 | Evaluation: quit by bundle id from a LaunchAgent helper (partial, 2026-10-30: terminate works with no prompt for TextEdit, Pages, Music; still open: an app holding unsaved work that keeps its save prompt, Safari, Messages, Chrome, Firefox, a second Mac, reopen restoring windows; TextEdit and Pages autosave, so they need a dirty, titled document or the Ask-to-keep-changes setting to show a prompt) | Measured on the Studio and a second Mac: whether consent prompts appear, what Safari, Music, Messages, Chrome, Firefox, TextEdit and Pages do with unsaved content, GB freed per app, reopen restores windows |
| MEM-SPACE-08 | The helper (list, quit, reopen) with the floor refusal and the socket | Tests: a floor app is refused; a refusing app is reported, never killed; no signal is ever sent |
| MEM-SPACE-09 | Settings spec and the Performance card: mode, lists, starter, picker, Reopen switches | Screenshots opened and judged; every change states its effect |
| MEM-SPACE-10 | The ladder step: smallest set, skip rules, wait 20 s, report, restore | Replay and live: a job short by 9 GB closes only a 9 GB app; a refusing app is skipped; apps reopen |
| MEM-SPACE-11 | Status page admin line for what was closed, refused and reopened, read live | Names admin only; job record holds counts only; nothing to approve or answer |
| MEM-SPACE-12 | Wizard question and permission test | Dedicated hub never sees it; refusal leaves the feature Off with a plain line |

Order: 07 first (it can stop the rest); 08 and 09 together; 10 and 11 after the live-fit ladder (TIER-PRIO-07); 12 after SETUP-SIZE-01.

## 8. Reuse check

Prebuilt options considered: `NSRunningApplication.terminate()` and `NSWorkspace` (the platform quit and launch calls, used as they are); osascript
`quit` (works but needs per-app Automation consent, so rejected as the default path); a commercial game booster or memory cleaner (closed source, off
box updates and telemetry, and none knows jobs or the live fit; rejected, zero phone-home). Built on: the helper as the one reader of running apps, the
live-fit ladder, the settings registry and `SettingsShell`, SETUP-SIZE-01's wizard page. A missing picker control is a kit change in `commons` first
(rule 9c).

## 9. Rules check

Rule 6a: app names appear to admins only, on the Status page and the Performance card, never on another person's card. Rule 8: children and teens
cannot reach the setting. S6: the existing Status row only, no new card, banner or poller. S4: the setting sits in one card. Owner rules: never kill by broad
pattern (this note quits by exact bundle id after the person's own opt-in, and sends no signals), never swap the chat model. Privacy: no app list leaves
the Mac. Rule 11: no outside engine.

## Supersedes

- Owner decision 2026-10-30: no Ask first mode and no approval kind; the explicit Always close list is the approval. (This note's first draft had one; it never shipped.)
- Making-space note section 4 ("Home adds no process-list reader") and row MEM-SPACE-03 ("no new reader"): the helper becomes the one reader of
  running apps (names and sizes) once installed, and MEM-SPACE-03's Status line has one source per install state (the helper when installed, otherwise the Stack's `memory.dev-load` reading), never both computed; the Stack's `devProtection()` keeps its separate
  whole-machine threshold event. Row MEM-SPACE-03 is amended when this lands.
- Making-space note section 9 (app names never stored): unchanged; this note keeps names in memory for the job's life and stores counts only.
- Making-space note section 1 item 2 and its R4 ("we never close an app that is not ours; the list only asks the person") is changed by the owner's
  2026-10-30 decision: with the mode on, Home quits listed apps. With the mode Off (default) nothing changes.
- Making-space note R3 and R4 order: with the mode Automatic, closing listed apps comes before lowering chat. In the Off mode the order is as before.
- The owner rule "stop only my own processes by recorded pid" (2026-10-21) concerned build sessions on the Studio, not the product. It stands for
  sessions; the product's close step is the opt-in feature here and sends a quit request by bundle id only.
