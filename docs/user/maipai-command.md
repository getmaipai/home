---
title: Turn MaiPai Home off and on
description: Stop Home to free up memory, start it again, and check that it is running.
---

# Turn MaiPai Home off and on

The installer adds a small command called `maipai`. It works on a Mac or a Linux computer.

Use it when you need the computer's memory for something else. Open Terminal on the computer that runs Home. Then type one of these.

| Type | What happens |
|---|---|
| `maipai status` | It tells you if Home and the AI engine are on, and how much memory the engine uses. |
| `maipai stop` | It turns off Home and the AI engine. It waits until their memory is free. |
| `maipai start` | It turns on the AI engine, then Home. It waits until Home answers. |
| `maipai restart` | It stops, then starts. |

`stop` and `start` ask for your computer password once. Home runs as a system service, so it needs an administrator.

## What you will see

When `stop` is done, it says: **Stopped. Home and the AI engine are off, and their memory is free.**

When `start` is done, it says: **Home is up**, and the address to open.

While Home is off, no one in the house can use it. Robots can't check in. Your data is safe.

## If something goes wrong

| It says | Do this |
|---|---|
| An install or upgrade is running right now | Wait for it to end. Then run the command again. |
| The AI engine did not stop within 30 seconds | Wait a moment. Run `maipai stop` again. Run `maipai status` to see what is still on. |
| Home did not answer within 120 seconds | Open the log it names. If the log is empty, run `maipai restart`. |
| MaiPai Home is not installed | Run the installer first. See [Install, upgrade, uninstall](install-upgrade-uninstall.md). |

On Windows, use the Services app to stop or start MaiPai Home. The `maipai` command is for Mac and Linux.
