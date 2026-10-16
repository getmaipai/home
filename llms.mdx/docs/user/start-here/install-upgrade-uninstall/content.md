# Install, upgrade, uninstall and fix the install (/docs/user/start-here/install-upgrade-uninstall)

## Before you start [#before-you-start]

Use the Mac itself. You need three things:

- A Mac with Apple silicon or Intel, and an internet connection.
- 3 GB of free disk space for Home. The installer checks this first.
- An account that can use `sudo` (an administrator).

The AI engine is a separate step that Home does for you later, inside the setup wizard, and only if this computer runs the AI. It needs 6 GB more to build, plus room for the AI models.

| Plan | Free space needed for the models |
|---|---|
| Recommended | 26 GB |
| Moderate | 19 GB |
| Minimal | 14 GB |

You do not need Homebrew. You do not need to install anything else first.

## Install [#install]

Open Terminal on the Mac and paste this one line. A plain SSH connection works too.

```bash
curl -fsSL https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.sh | sudo bash
```

This installs Home only, so it takes about a minute. When Home answers, the installer prints the address to open, such as `http://localhost:3000`. Open it in a browser to start the setup wizard.

If it stops, read the last lines. They say what went wrong and what to do. Fix that, then run the same line again. It picks up where it stopped and does not hurt anything already installed.

## The AI engine installs from the wizard [#the-ai-engine-installs-from-the-wizard]

The wizard asks where the AI runs.

- **This computer.** Home starts the AI engine install right away. A progress bar at the bottom of the wizard shows each step: fetch, build and start, then the model downloads. You can keep answering questions while it works.
- **Another computer.** Nothing is installed on this one. You pair the other computer later.

The engine needs the Mac's logged-in desktop to use the graphics chip. If nobody is logged in at the Mac, the bar stops and says so. Log in at the Mac and press Try again.

If the bar stops for any reason, it says what went wrong. Fix that and press Try again. It picks up where it stopped. You can also run the engine step by hand.

```bash
sudo bash /usr/local/maipai-home/scripts/install.sh --stack-only
```

## What happens after a restart [#what-happens-after-a-restart]

MaiPai Home starts by itself when the Mac starts. No one needs to log in.

The AI engine starts when the Mac's user logs in. To make that automatic, turn on automatic login: open System Settings, then Users and Groups, then Automatic login. macOS only allows automatic login when FileVault is off. For a Mac that must come back by itself after a power cut, turn FileVault off. The trade: anyone who can touch the Mac can read its disk, so keep it somewhere safe. If you keep FileVault on, log in once at the Mac after a restart and the engine starts.

## Tune the Mac [#tune-the-mac]

A Mac that runs Home all day works best with a few settings changed. Setup shows them as a list. You can also run the tool yourself at the Mac. It changes nothing unless you add `--yes`.

```bash
bash /usr/local/maipai-home/scripts/studio/host-tune.sh detect
```

Two kinds of change are in the list.

- Changes inside Home's own folders. Home makes them for you. They keep Spotlight out of Home's files and keep the big AI models out of Time Machine. Home's data stays in your backups.
- Changes to the whole Mac. These need an administrator, so Home asks first. If Home cannot do one, it shows the exact line to paste in Terminal at the Mac. They stop the Mac from sleeping, turn it back on after a power cut, stop big macOS upgrades by themselves (security updates stay on), and turn on SSH. One more lets the graphics chip use more memory. You only need that one for very big AI models later.

Every change can be undone. Run the same line with `revert` and the name of the item.

```bash
sudo bash /usr/local/maipai-home/scripts/studio/host-tune.sh apply power --yes
sudo bash /usr/local/maipai-home/scripts/studio/host-tune.sh revert power --yes
```

Some things only you can do, so the list shows them as advice: leave iCloud, Siri and Apple Intelligence off for this account, turn the screen saver off, give the Mac a fixed address in your router, approve it in Tailscale, and install nothing extra except the Command Line Tools.

## Upgrade [#upgrade]

Run the same install line again. If the AI engine is already installed, it is rebuilt too, so the Mac must have someone logged in. It does these steps in order:

1. Stops MaiPai Home and the engine.
2. Saves a copy of your data in `/usr/local/maipai-home/upgrade-backups`. It keeps the last two copies.
3. Replaces the program files. Your data, backups and engine models stay where they are.
4. Starts everything again and waits until it answers.

Home keeps the same address it had before.

To install one exact version, add `--version` and the release name.

```bash
sudo bash /usr/local/maipai-home/scripts/install.sh --version v0.1.0
```

## Go back one version [#go-back-one-version]

If an upgrade does not work for you, go back.

```bash
sudo bash /usr/local/maipai-home/scripts/install.sh --rollback
```

This installs the version you had before. It also puts back the data copy from just before the upgrade. Your newer data is not thrown away. It is moved to a folder named `data.rolled-back-` and the date, next to the install.

## Uninstall [#uninstall]

```bash
sudo bash /usr/local/maipai-home/scripts/uninstall.sh
```

This stops and removes the services. Your data is kept unless you type `DELETE MY DATA` exactly when it asks. Any other answer keeps everything. Make a backup first if you are not sure.

## Where the logs are [#where-the-logs-are]

| What | Where |
|---|---|
| MaiPai Home | `/usr/local/maipai-home/data/logs/` |
| The AI engine | `/usr/local/maipai-home/stack/data/logs/` |

A daily job keeps each log file under about 20 MB. It keeps the last three older copies.

## Change a port [#change-a-port]

Home uses port 3000 and the engine uses port 8770. If something else already uses one, the installer picks the next free number. To choose your own, set it before the install line.

```bash
curl -fsSL https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.sh | sudo MAIPAI_PORT=3100 MAIPAI_STACK_PORT=8780 bash
```

## Fix a problem [#fix-a-problem]

| What you see | What to do |
|---|---|
| The wizard bar says nobody is logged in at the Mac | Log in at the Mac, then press Try again in the wizard. |
| The wizard bar says the AI engine install stopped | Read the plain words on the bar, fix what they name, then press Try again. |
| "these tools are missing" | In Terminal run `xcode-select --install`, wait until it ends, then run the install line again. |
| "not enough free disk space" | Free up space, then run the install line again, or press Try again in the wizard. |
| "could not download" | Check the Mac's internet connection, then run the install line again. |
| macOS says it cannot verify a program | Open System Settings, then Privacy and Security, and choose Allow Anyway. Then run the install line again. |
| Home did not come up | Read the last lines of `/usr/local/maipai-home/data/logs/launchd.err.log`. Fix what they name, then run the install line again. |
| The engine does not answer after a restart | Log in at the Mac. The engine starts at login. |

If a run stops after it changed files, the last message tells you your data is safe. It also gives the rollback line.
