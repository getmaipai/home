---
title: Install, upgrade, uninstall and fix the install
description: Put MaiPai Home on a Mac, update it, go back a version, remove it, and fix the common install problems.
---

## Before you start

Use the Mac itself. You need three things:

- A Mac with Apple silicon or Intel, and an internet connection.
- Free disk space for the plan you choose. The installer checks it first, with the table below.
- An account that can use `sudo` (an administrator).

The installer and the setup wizard size the disk from one table. It adds up what each part takes once installed, 20 percent more, and the room an install uses while it runs (downloads being unpacked, Python tools being built), plus 2 GB for Home's own records. The installer checks the disk that holds Home, the disk that holds Home's data folder and the disk that holds the AI, so a data folder on another disk is judged by that disk. If there is not enough room it stops before it changes anything and says how much it needs and how much you have. If the room is enough but close, it warns and goes on.

| Plan | For a Mac with | Free space needed |
|---|---|---|
| Recommended | 64 GB of memory | 112 GB |
| Recommended | 128 GB of memory (adds Quick videos) | 144 GB |
| Moderate | 32 GB | 34 GB |
| Minimal | 16 or 24 GB | 17 GB |

On a Mac with 128 GB of memory the plan also includes Quick videos. **Detailed videos** (LTX-2.3, longer clips with sound and speech, about 74 GB) are optional and unticked: tick the row to add them. You accept the licences of the AI models and tools Home installs once, on the **Before you start** page, in the item **Home goes online for you**; the plan then lists the licence with its terms and never asks again. A Home set up before this wording shows one prompt, **Accept the licences for the AI models Home installs**, in **Repairs** and at the top of **Models and storage**: press **See the licences**, then **Accept** once. The Detailed videos licence is free to use under 10 million dollars of yearly revenue, and the model's own markings stay on what it makes. The total and the free-space check update at once. An upgrade never downloads them by itself: **Settings**, **AI and models** lists them with a **Get** button. The same screen offers more picture looks (Z-Image Turbo, slower but with more styles to add). Adding every extra on the plan screen (including Detailed videos and the faster chat engine) brings the Recommended plan to about 302 GB. The plan screen shows each part with its size, the total, and the free space on this computer. It turns the check green, amber or red as you turn parts on and off. Choose a smaller plan with `--plan moderate` or `--plan minimal` if the installer says there is not enough room.

Home itself, with the AI engine program that runs the models, takes about 1.5 GB. The rest is the AI models and the tools they run on. The wizard installs the AI engine later, only if this computer runs the AI.

You do not need Homebrew. You do not need to install anything else first.

## Install

Open Terminal on the Mac and paste this one line. A plain SSH connection works too.

```bash
curl -fsSL https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.sh | sudo bash
```

This installs Home only, so it takes about a minute. The installer also installs Deno (version 2.9.7, checked against a published checksum) into Home's own folder, so the built-in data packages work. You do not need Node, Deno or Bun on the Mac first. The installer uses its own Bun for every step.

When Home answers, the installer opens the setup address in your default browser, such as `http://localhost:3000`, and prints the same address as its last line. If no browser opens (for example over SSH), open that address yourself to start the setup wizard.

If it stops, read the last lines. They say what went wrong and what to do. Fix that, then run the same line again. It picks up where it stopped and does not hurt anything already installed.

## The AI engine installs from the wizard

The wizard asks where the AI runs.

- **This computer.** Home starts the AI engine install right away. A progress bar at the bottom of the wizard shows each step: fetch, build and start, then the model downloads. You can keep answering questions while it works.
- **Another computer.** Nothing is installed on this one. You pair the other computer later.

The plan lists what you get, including voice ("Voice: talk to Home"). The browser asks for the microphone the first time you use voice, not during setup.

If Home's own web search is not ready when the plan finishes, one more screen, **Turn on web search**, asks for the address of a SearXNG you run on your home network. Press **Test**. **Continue** turns on once the test for that exact address passes. Leave the address empty and press **Continue** to skip it, which turns on DuckDuckGo search for adults. You can change this later in **Settings**, then **Search**. See [Set up your hub](getting-started.md) for every wizard screen.

The engine needs the Mac's logged-in desktop to use the graphics chip. If nobody is logged in at the Mac, the bar stops and says so. Log in at the Mac and press Try again.

If the bar stops for any reason, it says what went wrong. Fix that and press Try again. It picks up where it stopped. You can also run the engine step by hand.

```bash
sudo bash /usr/local/maipai-home/scripts/install.sh --stack-only
```

## What happens after a restart

MaiPai Home starts by itself when the Mac starts. No one needs to log in.

The AI engine starts when the Mac's user logs in. To make that automatic, turn on automatic login: open System Settings, then Users and Groups, then Automatic login. macOS only allows automatic login when FileVault is off. For a Mac that must come back by itself after a power cut, turn FileVault off. The trade: anyone who can touch the Mac can read its disk, so keep it somewhere safe. If you keep FileVault on, log in once at the Mac after a restart and the engine starts.

## Tune the Mac

A Mac that runs Home all day works best with a few settings changed. Setup shows them as a list. You can also run the tool yourself at the Mac. It changes nothing unless you add `--yes`.

```bash
bash /usr/local/maipai-home/scripts/studio/host-tune.sh detect
```

Three kinds of change are in the list.

- Changes inside Home's own folders. Home makes them for you. They keep Spotlight out of Home's files and keep the big AI models out of Time Machine. Home's data stays in your backups.
- Keep the screen awake (`display-awake`). Some monitors lose their picture after the screen sleeps. A small service starts when you log in and keeps the screen and Mac awake. It needs no administrator password. Run this as your Mac user, without sudo: `bash /usr/local/maipai-home/scripts/studio/host-tune.sh apply display-awake --yes`.
- Changes to the whole Mac. These need an administrator, so Home asks first. If Home cannot do one, it shows the exact line to paste in Terminal at the Mac. They stop the Mac from sleeping, turn it back on after a power cut, stop big macOS upgrades by themselves (security updates stay on), and turn on SSH. One more lets the graphics chip use more memory. You only need that one for very big AI models later.

Every change can be undone. Run the same line with `revert` and the name of the item.

```bash
sudo bash /usr/local/maipai-home/scripts/studio/host-tune.sh apply power --yes
sudo bash /usr/local/maipai-home/scripts/studio/host-tune.sh revert power --yes
```

A few things only you can do, so they sit in a closed list called "things to do yourself". Each says why: keep Apple's iCloud, Siri and Apple Intelligence off because they send data to Apple; turn the screen saver off because it keeps the graphics chip busy; give the Mac a fixed address so phones and robots can always find it; and install nothing extra except the Command Line Tools.

## Upgrade

Run the same install line again. If the AI engine is already installed, it is rebuilt too, so the Mac must have someone logged in. It does these steps in order:

1. Stops MaiPai Home and the engine.
2. Saves a quick copy of your data in `/usr/local/maipai-home/upgrade-backups`, in a minute or two. Big downloads such as offline books and models stay where they are. It keeps the last two copies.
3. Replaces the program files. Your data, backups and engine models stay where they are.
4. Starts everything again and waits until it answers.

Home keeps the same address it had before.

To install one exact version, fetch the installer from that release's tag and add `--version` with the same name. This is the safest way, because the installer you run is the one that was tested with that release.

```bash
curl -fsSL https://raw.githubusercontent.com/getmaipai/home/v0.2.5/scripts/install.sh | sudo bash -s -- --version v0.2.5
```

Each release carries its own AI engine. The installer builds the engine from the exact version that release names, not from the newest code. So a fix to the engine reaches your Mac only when you install a Home release that includes it.

## Go back one version

If an upgrade does not work for you, go back.

```bash
sudo bash /usr/local/maipai-home/scripts/install.sh --rollback
```

This installs the version you had before. It also puts back the data copy from just before the upgrade. Your newer data is not thrown away. It is moved to a folder named `data.rolled-back-` and the date, next to the install.

## Uninstall

```bash
sudo bash /usr/local/maipai-home/scripts/uninstall.sh
```

This stops and removes the services. Your data is kept unless you type `DELETE MY DATA` exactly when it asks. Any other answer keeps everything. Make a backup first if you are not sure.

## Where the logs are

| What | Where |
|---|---|
| MaiPai Home | `/usr/local/maipai-home/data/logs/` |
| The AI engine | `/usr/local/maipai-home/stack/data/logs/` |

A daily job keeps each log file under about 20 MB. It keeps the last three older copies.

## Change a port

Home uses port 3000 and the engine uses port 8770. If something else already uses one, the installer picks the next free number. To choose your own, set it before the install line.

```bash
curl -fsSL https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.sh | sudo MAIPAI_PORT=3100 MAIPAI_STACK_PORT=8780 bash
```

## Fix a problem

| What you see | What to do |
|---|---|
| The wizard bar says nobody is logged in at the Mac | Log in at the Mac, then press Try again in the wizard. |
| The wizard bar says the AI engine install stopped | Read the plain words on the bar, fix what they name, then press Try again. |
| "these tools are missing" | In Terminal run `xcode-select --install`, wait until it ends, then run the install line again. |
| "not enough free disk space" | Free up space, then run the install line again, or press Try again in the wizard. |
| "could not download" | Check the Mac's internet connection, then run the install line again. |
| macOS says it cannot verify a program | Open System Settings, then Privacy and Security, and choose Allow Anyway. Then run the install line again. |
| "Home is already running" with a lock file | Another copy of Home is running on this Mac, usually one started from a developer folder. Stop it, then run the install line again. |
| Home did not come up | Read the last lines of `/usr/local/maipai-home/data/logs/launchd.err.log`. Fix what they name, then run the install line again. |
| The engine does not answer after a restart | Log in at the Mac. The engine starts at login. |

If a run stops after it changed files, the last message tells you your data is safe. It also gives the rollback line.
