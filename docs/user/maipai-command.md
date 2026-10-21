---
title: Turn MaiPai Home off and on
description: Stop Home to give the computer its memory back, start it again, and check that it is running.
---

# Turn MaiPai Home off and on

The installer puts a small command called `maipai` on your Mac or Linux computer. Use it when you want the computer for
something big, like a game or a video edit, and Home is using the memory.

Open Terminal on the computer that runs Home, then type one of these.

| Type | What it does |
|---|---|
| `maipai status` | Says if Home and the AI engine are on, and how much memory the AI engine is using. |
| `maipai stop` | Turns off Home and the AI engine, then waits until their memory is free. |
| `maipai start` | Turns the AI engine on, then Home, and waits until Home answers. |
| `maipai restart` | Stop, then start. |

`stop` and `start` ask for your computer password once. Home runs as a system service, and that needs an administrator.

## What you will see

When `stop` is finished it says: **Stopped. Home and the AI engine are off, and their memory is free.**

When `start` is finished it says: **Home is up**, and the address to open.

While Home is off, nobody in the house can use it. Robots cannot check in, and chats and pictures wait until you start it.
Your data is not touched.

## If something goes wrong

| It says | Do this |
|---|---|
| An install or upgrade is running right now | Wait for the install to finish, then run the command again. |
| The AI engine did not stop within 30 seconds | Wait a moment and run `maipai stop` again. `maipai status` shows what is still running. |
| Home did not answer within 120 seconds | Look at the log it names. If it is empty, run `maipai restart`. |
| MaiPai Home is not installed | Run the installer first. See [Install, upgrade, uninstall](install-upgrade-uninstall.md). |

Windows: use the Services app to stop or start MaiPai Home. The `maipai` command is for Mac and Linux.
