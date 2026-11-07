---
title: Teach MaiPai your own phrase
description: Make a command so a phrase you choose gets a fixed answer or controls a smart-home device.
---

# Teach MaiPai your own phrase

A command is a phrase you choose. When someone says it exactly, MaiPai does what you set. For example, "when I say movie night, dim the lights." A command only fires on the exact phrase, never on a guess.

Adults can make commands. Children and teens cannot.

## Make a command

1. Open **Settings**, then **Voice and robot**.
2. Find the **Commands** card and choose **Create a command**.
3. Under **Trigger phrase**, type the words, such as "movie night".
4. Under **Who can trigger this command**, pick the lowest role that may use it.
5. Under **What this command does**, choose **Say something back** or **Control a smart-home device**.
6. Fill in the boxes that appear. For **Say something back**, type what MaiPai says, and a spoken version if you want it to sound different. For a smart-home device, type the Home Assistant domain (such as light), the service (such as turn_off) and the entity id (such as light.living_room).
7. Press **Create command**.

You will know it worked when you say the phrase and MaiPai answers or the device changes.

## Things to know

- A smart-home command needs Home Assistant connected. See [The House page](house.md).
- Locks, covers, alarms, garage doors and valves count as security devices. Only an owner or an admin can make a command for them, and only an adult or higher can trigger it.
- Two commands cannot share one phrase.

## See and remove commands

An owner or admin sees every command under **Settings**, then **Voice**, then **Commands**. Each row shows the phrase, what it does and who can use it. Choose **Delete** to remove one. You can delete a command you made yourself.
