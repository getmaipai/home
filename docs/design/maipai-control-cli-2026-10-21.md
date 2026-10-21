# `maipai` start, stop, restart and status (2026-10-21)

A person who installed Home has no simple way to turn it off and give the memory back, or to turn it on again. The only installed
commands are the installer and, on a computer that also runs the AI, `maipai-engine`. This note adds one command, `maipai`,
for the person at the keyboard.

## Answer

One bash script, `scripts/maipai`, installed to `/usr/local/bin/maipai` by `install.sh` (the way `maipai-engine` is). It works
on macOS and Linux. Windows keeps its service-manager buttons until `install.ps1` has a service to control (a follow-up row).

```
maipai status     Home: running or stopped, health answer; AI engine: running or stopped; memory the AI engines hold
maipai stop       stop Home, then the AI engine, then wait until no engine process is left
maipai start      start the AI engine, then Home, then wait for Home to answer
maipai restart    stop, then start
```

## Supersedes

Nothing.

## Reuse check (principle 6)

- **Extend `maipai-engine`** (`scripts/engine-computer/maipai-engine`): rejected. It exists for the pairing of a separate
  computer that only runs the AI engine, on Linux; it has no Home service to control and no macOS path. Adding Home
  start and stop to it would mix two jobs and still leave macOS without a command.
- **Document the raw `launchctl` and `systemctl` calls**: rejected. Four calls in the right order, two services, a password
  and a wait for the memory to be free is what went wrong by hand on 2026-10-21 (Home restarting engines the person had just
  stopped; an engine left holding memory). One tested command is the fix.
- **A button in the app**: not possible as the whole answer, because Home cannot stop itself and start itself again.

## What each command controls

| | Home | AI engine (the Stack) |
|---|---|---|
| macOS | `/Library/LaunchDaemons/com.maipai.home.plist`, a system daemon (needs `sudo`) | `com.maipai.stack` LaunchAgent of the console user (`launchctl ... gui/<uid>`) |
| Linux | `maipai-home.service` (needs `sudo`) | `maipai-stack.service`, a systemd user unit of the console user |

The two services are controlled together because stopping only one does not free memory: Home restarts the engines, and
the engines alone keep their models loaded.

## Rules

1. **Order.** Stop Home first so it cannot respawn the engines; start the Stack first so Home finds it.
2. **Memory is the proof.** `stop` waits (up to 30 s) until no process of the engine family is left (`llama-server`,
   `mlx_tts_server`, the Stack binary) and says so; if one stays it names it and exits 1. It never kills by pattern.
3. **No fighting an install.** `start`, `stop` and `restart` refuse, with a plain message, while the installer or an upgrade is
   running.
4. **Password.** Home is a system service, so the command calls `sudo` and the person types their password once. This
   change adds no sudoers rule: a passwordless rule for stopping Home is a security decision for the owner (open question below).
5. **One state file** is not needed: the service manager is the single source of truth, so `status` reads it, never a copy.
6. **Errors say what happened and what to do** (STYLE.md): for example "Home did not answer within 2 minutes. Look at
   `<data>/logs/launchd.err.log`, or run `maipai status`."
7. **Paths and ports come from the installer's own records** (`MAIPAI_PORT`, the plist or unit), not guesses.

## Testing without touching a real service

The script reads every external tool by name from `PATH` (`launchctl`, `systemctl`, `sudo`, `curl`, `pgrep`, `uname`), so
the tests put stubs first on `PATH`, run `maipai` with `MAIPAI_ROOT` pointing at a temporary folder, and assert on the calls
the stubs recorded. The suite never talks to a live Home, Stack or launchd.

## Agents

The live-machine guard (RELIABILITY-PREVENT-03, `live-guard.sh`) must also deny `maipai stop`, `maipai start` and
`maipai restart` for agents unless the command sets `ALLOW_LIVE=1`; otherwise an agent could use the new command to do what
the guard denies for `launchctl`. `maipai status` stays allowed. The guard lives in `.github`; this change adds a note to
that backlog row, not the hook.

## Not in this change

- A passwordless rule (`/etc/sudoers.d/maipai-control`) so the command never prompts. Owner decision.
- Windows (`maipai.ps1` over the Home service). Backlog row.
- A button in the app. Home cannot stop itself and then start itself, and the existing Restart flows are separate.

## Open question for the owner

Should the installer add the narrow sudoers rule above on macOS and Linux? It only allows the exact `launchctl bootout|bootstrap`
and `systemctl stop|start` calls for the Home unit, for the installing administrator. Default in this change: no.
