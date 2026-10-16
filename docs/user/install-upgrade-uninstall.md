---
title: Install, upgrade, uninstall and fix the install
description: Put MaiPai Home on a Mac, update it, go back a version, remove it, and fix the common install problems.
---

## Before you start

Use the Mac itself, not another computer. Sit at its screen, or use Screen Sharing, and log in. The AI engine needs that logged-in desktop to use the graphics chip. A plain SSH connection is not enough.

You need three things:

- A Mac with Apple silicon or Intel, and an internet connection.
- Free disk space. The installer checks this first and tells you if it is too little.
- An account that can use `sudo` (an administrator).

| Plan | Free space needed |
|---|---|
| Recommended | 26 GB |
| Moderate | 19 GB |
| Minimal | 14 GB |

You do not need Homebrew. You do not need to install anything else first.

## Install

Open Terminal on the Mac and paste this one line.

```bash
curl -fsSL https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.sh | sudo bash
```

To pick a plan, add it after `bash`.

```bash
curl -fsSL https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.sh | sudo bash -s -- --plan moderate
```

The installer takes a few minutes. When it ends, it waits until MaiPai Home answers. Then it prints the address to open, such as `http://localhost:3000`. Open that address in a browser to finish setup.

If it stops, read the last lines. They say what went wrong and what to do. Fix that, then run the same line again. It picks up where it stopped and does not hurt anything already installed.

## What happens after a restart

MaiPai Home starts by itself when the Mac starts. No one needs to log in.

The AI engine starts when the Mac's user logs in. To make that automatic, turn on automatic login: open System Settings, then Users and Groups, then Automatic login. If FileVault is on, macOS does not allow automatic login. After a restart, log in once at the Mac and the engine starts.

## Upgrade

Run the same install line again. It does these steps in order:

1. Stops MaiPai Home and the engine.
2. Saves a copy of your data in `/usr/local/maipai-home/upgrade-backups`. It keeps the last two copies.
3. Replaces the program files. Your data, backups and engine models stay where they are.
4. Starts everything again and waits until it answers.

Home keeps the same address it had before.

To install one exact version, add `--version` and the release name.

```bash
sudo bash /usr/local/maipai-home/scripts/install.sh --version v0.1.0
```

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
| "nobody is logged in at this Mac's own screen" | Log in at the Mac, open Terminal, and run the install line there. |
| "these tools are missing" | In Terminal run `xcode-select --install`, wait until it ends, then run the install line again. |
| "not enough free disk space" | Free up space, or add `--plan minimal`. |
| "could not download" | Check the Mac's internet connection, then run the install line again. |
| macOS says it cannot verify a program | Open System Settings, then Privacy and Security, and choose Allow Anyway. Then run the install line again. |
| Home did not come up | Read the last lines of `/usr/local/maipai-home/data/logs/launchd.err.log`. Fix what they name, then run the install line again. |
| The engine does not answer after a restart | Log in at the Mac. The engine starts at login. |

If a run stops after it changed files, the last message tells you your data is safe. It also gives the rollback line.
