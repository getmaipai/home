# Studio runbook

## Step 1b: Host tuning

Run `bash scripts/studio/host-tune.sh detect` at the Mac. The item list is `no-spotlight`,
`no-timemachine-models`, `power`, `display-awake`, `wired-limit`, `no-auto-major-upgrade`,
`remote-login`, `advice-accounts`, `advice-radios`, `advice-network`, `advice-toolchains`,
`advice-login`, and `advice-screensaver`. The setup wizard uses the same script.

Apply `display-awake` as the signed-in Mac user, without sudo:

```bash
bash scripts/studio/host-tune.sh apply display-awake --yes
```

It installs `~/Library/LaunchAgents/com.maipai.display-awake.plist`, a login service running
`/usr/bin/caffeinate -d -i`. It keeps the screen and Mac awake while that user is logged in.
The `power` item still sets `displaysleep 10`; this login service keeps display sleep from taking effect.
The other consent items (`power`, `wired-limit`, `no-auto-major-upgrade`, `remote-login`) need an administrator.
The two folder items need no sudo. Advice items must be set by hand.

Run detect again. The expected line is:

```text
display-awake            consent  ok       Keep the screen from sleeping
```

To undo it, run `bash scripts/studio/host-tune.sh revert display-awake --yes` as the same user.

## Troubleshooting

### No picture on the monitor

The monitor may stay blank while Screen Sharing still works. macOS lists only a virtual display;
Settings or a display check run with `swift` shows no physical monitor.

Recover with a cold power cycle: hold the Mac's power button for about 10 seconds, wait 15 seconds,
then press it once. With FileVault on, type the disk password at the Mac.

The `display-awake` item prevents screen sleep, which can leave some monitors unable to show a picture
when they wake. It does not repair a link that is already lost. If it recurs: drop the monitor to
60 Hz, try another cable or port, and bypass any KVM.
