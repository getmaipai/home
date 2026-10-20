# Robots in Home: the switch, the Bot host and installing a StackChan (2026-10-20)

Design note, hub side. Follows [robot-register-test-configure-2026-10-20.md](robot-register-test-configure-2026-10-20.md). Rules in
[RULES.md](RULES.md) govern; nothing here asks for a rule change. Owner decisions (Jesse, 2026-10-20, in the wizard): a Robots
switch in Settings, StackChan first, installed from the browser.

## Supersedes

- [robot-register-test-configure-2026-10-20.md](robot-register-test-configure-2026-10-20.md), its "What stays in the bot" bullet:
  a StackChan installed from Home no longer joins its Bot app on the bot's local page. A StackChan whose Bot app runs on another
  computer still does.
- Robot settings, the add flow and the robot password section showing to every admin: they now show only while the Robots switch
  is on.
- ROBOT-BODY-JOIN-01 (BACKLOG): narrowed in the same commit to a body whose Bot app runs on another computer.
- `checkForBotUpdate` (`backend/src/lib/updates.ts:215`) checking whenever a robot is paired: it now also needs the switch on.

## The problem

A household that buys a StackChan cannot set it up from Home. Today it takes a developer machine:

1. **The brain.** A StackChan is a thin body. Its brain is the Bot app with `MAIPAI_BODY=stackchan`, which starts the xiaozhi and
   avatar WebSocket services the robot connects to (bot `docs/dev/stackchan-service.md`). Nothing in Home runs a Bot app.
2. **The firmware.** It is flashed once over USB by `bot/body/scripts/stackchan_flash.py`, which needs ESP-IDF 5.5.4 and a terminal.
3. **The identity.** The build bakes the avatar host address in (`CONFIG_STACKCHAN_SERVER_URL`, bot patch 011), and the pairing
   token and Client-Id go into an NVS image at 0x9000 built by bot `xiaozhi/provision.py`. The token is approved on the bot's own
   local page (`xiaozhi/pairing.py` `PairingStore.approve`).
4. **No on/off.** Robot settings and the add flow show to every admin of every household, robot or not.

## Who

Admins only: the switch, the install and the Bot host. Adults, teens and children see nothing new. A child's robot keeps every child
rule that exists today (rule 0 first).

## Reuse check

| Need | Existing part | Verdict |
|---|---|---|
| Flash a StackChan from a browser | ESP Web Tools (Espressif, Apache-2.0) | Not used as the UI: its install dialog is its own web components, not the kit, so it fails rule 9b. Its manifest shape (`name`, `version`, `builds[{chipFamily, parts[{path, offset}]}]`) is adopted as the base of `FirmwareFlashManifest`, so a manifest stays readable by ESP Web Tools too. |
| The flashing protocol | `esptool-js` (Espressif, Apache-2.0), the library ESP Web Tools is built on | Used. Home writes no protocol of its own. Downloaded per RELEASES-AND-DEPENDENCIES.md, never vendored. |
| Know a bot release exists | `updates.ts` `checkRelease(BOT_TARGET)` (ROBOT-UPDATES-01) | Reused. |
| Download and verify a bot release | none: `updates.ts` stores the GitHub digest and downloads nothing (:79-82, :258) | New, one verifier in `backend/src/lib/botRelease.ts`, shared with ROBOT-UPDATE-APPLY-01 (Reachy) so there is one bot-release path. |
| Run and restart the Bot app | `backend/src/lib/sidecars.ts` (`startSidecar` :1239, backoff :335, `watchEngine` crash-loop cap, `raiseCrashIssue` :1223 with fix `restart_sidecar:<id>`) | Reused: each hosted Bot app is a sidecar. |
| Show it is down | `lib/issues.ts` `raiseIssue` (Repairs, fix button) and the health list (`statusApps.ts`, `appNeeds.ts` `CORE_APPS`) | Reused. No status line or button of its own (S6). |
| Background download progress | `lib/installStatus.ts` | Reused (S6 background progress). |
| Hide robot cards | area and card `needs` (`settingsAreas.ts:46`, spec `areas.json`) | Reused with one new capability. |
| Build the NVS image, approve a body | bot `provision.py`, `PairingStore` | Reused through the Bot app's own command, never copied into Home. |
| Encrypt a file at rest | `lib/backupCrypto.ts` `encryptFile` / `decryptFile` | Reused for the firmware backup. |

## 1. The Robots switch

- One household key, `home.robots.enabled` (boolean, default off, admin scope), defined in `commons/spec` first.
- **Where.** A new card "Robots" with no `needs`, first in the household `robot` area labelled Devices (spec `areas.json` around
  :519). Every other robot card (household Devices :519-529 and the person-scoped Robot card :178-199) gains the need
  `robots.enabled`, a capability `settingsAreas.ts` adds when the key is on. Without that split the switch would hide itself.
- **Off:** the add, install and password sections are hidden, no Bot host runs, and `checkForBotUpdate` does not check.
- **Upgrade.** A household that already has a paired robot when this ships is migrated to on (a one-time migration reading
  `listDevicesByKind("robot")`), so nothing that works today goes dark.
- **Turning it off with robots paired** asks once, from a spec copy field (`confirm_off`) through `describeSetting` (S5): "Your
  robots stop working until you turn this back on. Their settings and memories stay." The spec has no confirm field today and
  `SettingsShell` has no confirm support, so a commons row adds both first (rule 9c). Off stops the hosted Bot apps and refuses
  robot device sockets with a close reason from a spec copy field. No new spoken line: a robot that loses Home plays its existing
  offline clip. Nothing is deleted.
- **On:** shows the robot cards. Turning it on downloads nothing; the first "Add a StackChan" does.

## 2. The Bot host on the hub

- **Model: a sidecar.** Home runs one Bot app per StackChan as a sidecar under `sidecars.ts`, the same supervisor that runs its
  engines (SERVICES.md, "the daemon's own supervisor restarts its engine children"). It is not a MaiPai service, so the one-instance
  rule does not apply to it; Home itself stays the one instance. One Bot app per body keeps each robot's memory and identity its own
  (principle 2: it can later move to its own computer with no data change).
- **Data.** `~/.maipai/home/data/robots/<deviceId>/`, declared `backupMode: "include"` (the robot's memory is household data).
- **Ports.** Two ports per robot, each chosen once at install by binding port 0 and reading the port the system gave, and kept in
  `robots/<deviceId>/host.json` (the shared device record stays unchanged). They never change after, because the NVS image holds the
  address; a hub restart reuses them. A port taken by something else raises a Repairs item naming the robot and the port; Home never
  kills the other process (the sidecar's `freePort` reaps whatever holds a port, so the Bot app does not use it) and never moves.
- **Code.** The "Robot app" row of UPDATES.md: a GitHub Release of `bot`, following the hub's channel. Home pins the bot version and
  each asset's sha256 in one file, bumped with a Home release. `botRelease.ts` downloads the hub-platform build (macOS arm64, Linux
  x86_64 and arm64), verifies the signature and every sha256 before unpacking, stages it under `releases/<version>`, and reports
  progress through `installStatus.ts`. The download is a new row on the privacy page (`privacy.ts` `platformConnections`): "When
  you add your first StackChan, Home downloads the robot app from GitHub."
- **Health.** The sidecar's crash-loop cap raises one Repairs item through `raiseCrashIssue`. `SidecarConfig` gains an optional
  display `label` that `raiseCrashIssue` uses in the title when set, so the item reads "Robot brain for <name> stopped" (fix
  "Restart") instead of the sidecar id; it resolves when the sidecar is healthy. Each hosted robot appears in the health list as one `StatusApp`. The
  robot's card keeps its existing online pill and gains nothing.
- **Pairing the Bot app to Home (T2).** Home writes a single-use pairing secret, 32 random bytes, into the robot's data directory
  with file mode 0600 before it starts the sidecar. The Bot app presents it once at Quick Connect create; Home approves the request
  only when the secret matches the one stored (hashed) for that deviceId, then deletes it. A missing, reused or mismatched secret
  falls back to the normal code-read-aloud approval. The Bot app reports `no_vendor_login`, so ROBOT-PAIR-02 skips the password step.
- **Forget.** The robot card's existing Forget confirm gains one sentence: "This also deletes the robot's memories and its saved
  firmware backup." On confirm, Home stops the Bot app, unregisters its sidecar and `StatusApp`, resolves its Repairs items, and
  deletes `robots/<deviceId>/`. Existing backups keep their copy until they age out.

## 3. Installing a StackChan from the browser

The flow, under Devices > Robots > Add a StackChan:

1. **Check the browser.** Web Serial needs Chrome or Edge on a computer and a secure page (`window.isSecureContext`, the same test
   as `frontend/src/lib/voice/mic-capture.ts`). Otherwise: "Installing needs Chrome or Edge on a computer, with Home opened at its
   https address. Open Home there and try again."
2. **Plug in.** "Plug the StackChan into this computer with a USB-C data cable." The person picks the port in the browser's own
   chooser. On the bench unit, esptool's default reset entered download mode with no button press (bot session, 2026-10-20).
3. **Back up.** The browser reads the full 16 MiB flash (about 90 s at 2 000 000 baud) and uploads it. The stock image can hold the
   household's Wi-Fi password, so the hub encrypts it on arrival with `encryptFile` and stores only the encrypted file in the
   robot's data directory. It travels with household backups, which are encrypted too (BACKUPS.md). The browser keeps no copy.
4. **Make it this robot's.** The hub creates the device record, picks its two ports, downloads the bot release if needed, starts
   the Bot host (section 2), and asks the Bot app for an NVS image through its own command (`provision` run by Home on its child's
   data directory; no network call, no second copy of `provision.py`). The image holds the Bot host's address and a **single-use
   enrollment code**, never the long-lived token: the code is valid for 24 hours, is consumed on the robot's first connection,
   where the Bot app swaps it for the real token, and is revoked by "Cancel install" on the card. The NVS bytes are served with
   `Cache-Control: no-store` and are never logged.
5. **Write.** The browser writes each image at the offsets the release's flash manifest names (section 4), at 460 800 baud,
   checks each region's hash, and resets the robot. One progress bar names the step.
6. **Wi-Fi.** The NVS image sets `xiaozhi/boot_ai=1` and `app_config/is_configed=1` (bot commit 631ae8b, BOT-BOOT-AI-01), so the
   robot boots into its AI agent and, with no Wi-Fi yet, opens its own setup hotspot. Home shows the steps: on a phone, join the
   robot's hotspot and choose the home Wi-Fi. Home never asks for or holds the Wi-Fi password.
7. **Done.** The card turns Online when the robot reaches its Bot host. If it does not within 3 minutes, a destructive kit Alert
   (S6 table): "The robot did not reach Home. Check it joined the same Wi-Fi as this hub, then press Retry."

Updates later write only the app and assets regions, never 0x9000 (an NVS write wipes Wi-Fi and pairing). That is its own row.

### Kit Elements and parts

`Dialog` for the install, `Progress` for the write, `Alert` for the browser check and the failure, `Button` for every action, and
`SettingsRenderer` for the switch. No Home wrapper and no stepper (the kit has none); the steps are the dialog's own text. Rule 9
holds; `bun run lint:ui-rules` passes.

## 4. What the bot and spec halves must carry

Facts from bot `release.sh:49-62` (2026-10-20): the release ships `stack-chan-maipai.bin`, `generated_assets.bin`,
`ota_data_initial.bin`, `manifest.json`, `image-strings.txt` and `SHA256SUMS`. It carries no offsets, bootloader, partition table
or signature, and the avatar URL is baked in at build time. So, spec first:

- **commons `SPEC-FLASH-MANIFEST-01`:** a `FirmwareFlashManifest` record shaped like ESP Web Tools' manifest (`name`, `version`,
  `builds[{chipFamily, parts[{path, offset}]}]`) plus flash size and, per part, byte length and sha256; signed like a catalog
  package. Bot emits it; Home reads it; neither invents offsets.
- **commons `SPEC-SETTING-CONFIRM-01`:** a `confirm_off` copy field on boolean keys and `SettingsShell` support for it.
- **bot `BOT-RELEASE-FLASH-01`:** the release ships the flashable set (bootloader, partition table, app, assets, OTA data) with the
  manifest; one signed binary serves every household. A firmware patch makes the avatar URL, the Device-Id and the Client-Id read
  NVS as the xiaozhi URL already does (namespace `websocket`, key `url`).
- **bot `BOT-STACKCHAN-ENROLL-01`:** `PairingStore` issues a single-use, 24-hour enrollment code; the firmware sends it on first
  connection, receives the long-lived token and stores it in NVS; `provision` writes the code, not a token.
- **bot `BOT-HUB-BUILD-01`:** a self-contained Bot app build per hub platform in the release, with a `provision` command Home can
  run, and a Quick Connect create that presents a pairing secret from its data directory.

## What is out of scope

- Flashing from the hub's own USB port (the owner chose the browser). The Reachy Mini install (ROBOT-UPDATE-APPLY-01 keeps it, and
  shares `botRelease.ts`).
- Firmware updates and "Put the original firmware back" (later rows, after the first install is proven on the unit).
- A StackChan whose Bot app runs on another computer (ROBOT-BODY-JOIN-01, narrowed).

## Rows

| Row | Repo | After |
|---|---|---|
| SPEC-FLASH-MANIFEST-01 | commons | none |
| SPEC-SETTING-CONFIRM-01 | commons | none |
| BOT-RELEASE-FLASH-01 | bot | SPEC-FLASH-MANIFEST-01 |
| BOT-STACKCHAN-ENROLL-01 | bot | none |
| BOT-HUB-BUILD-01 | bot | none |
| ROBOTS-SWITCH-01 | home | SPEC-SETTING-CONFIRM-01 (its key goes spec first inside the row) |
| ROBOT-HOST-01 | home | ROBOTS-SWITCH-01, ROBOT-PAIR-02, BOT-HUB-BUILD-01 |
| STACKCHAN-INSTALL-01 | home | ROBOT-HOST-01, BOT-RELEASE-FLASH-01, BOT-STACKCHAN-ENROLL-01 |
