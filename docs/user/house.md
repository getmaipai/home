---
title: Control your house from Home
description: See rooms and devices on the House page, and ask chat to turn lights on or off and lock doors.
---

# Control your house from Home

The **House** page shows your rooms and the devices in them. It needs Home Assistant, the free smart-home hub, to be connected first.

## Connect Home Assistant

An owner or admin does this once.

1. Open **Settings**, then **House**.
2. Under **Connection**, enter the Home Assistant address and its access token. The same two boxes are under **Settings**, **Apps and devices**, **Integrations**.
3. Press **Test connection**.

You will know it worked when Home says "Connected" and how many rooms and devices it found.

Until then, the House page says "Home Assistant is not set up yet" and offers **Open Settings**.

## Choose who can do what

On **Settings**, **House**, **Who can control what** lists each room and each device. For every person, choose **None**, **See** or **Control**. Owners are always allowed. Some devices, such as locks, are marked **Locked by rule** for children, and a teen needs a choice on that very device. For some devices an adult can also have **Confirm**, which asks before the action.

## Use the House page

Open **House**. Each room shows how many devices are on.

- A light has a switch and a brightness control.
- A scene has an activate button.
- A lock asks you to confirm before it locks or unlocks.
- A switch, fan or blind turns on and off, or opens and closes.

The page checks every few seconds. If a device does not answer, you see "The ... did not respond. Try again." You only see the devices that were shared with you. If none were, the page says "No devices are shared with you yet."

## Ask in chat

Say "Turn on the kitchen lights" or "Lock the front door." MaiPai only acts on devices you may control, and it tells you what it did. Turning lights on and off works for anyone who has **Control** on that light. Locking doors needs a teen or older with **Control** on the lock. Adults can also ask for a schedule, such as lights on at a set time. After an action, an **Undo** button appears.
