---
title: Robots
description: Add a StackChan and connect it to Home.
---

# Add a StackChan

An owner or admin can add a StackChan from **Settings**, then **Apps and devices**, then the **Devices** tab.

First, turn on **Robots**. Then choose **Add a robot** and **Add a StackChan**. Use Chrome or Edge on a computer, and open Home at its secure `https` address. Phones and tablets cannot install the robot.

Plug the StackChan into the computer with a USB-C data cable. Choose its port when the browser asks. Home saves a backup of the robot before it changes anything. The backup may include the Wi-Fi password already saved on the robot. Home encrypts the backup as it arrives and keeps it with the robot's files.

Keep the robot connected while Home writes and checks the new software. When Home says it is ready, use a phone to join the Wi-Fi network named by the robot. Choose your home Wi-Fi in the page that opens. Home never asks you to type or share your Wi-Fi password.

The robot should come online in a few minutes. It needs to join the same Wi-Fi network as the Home computer. If it does not come online, check its Wi-Fi connection and press **Retry**.

## Cancel an install

If a robot has never come online, an owner or admin can choose **Cancel install** on its card. This revokes its one-time enrollment code and removes the robot and its saved flash backup. You can start again with **Add a StackChan**.

## Update a robot's software

When a newer version is ready, open the robot in **Settings**, **Apps and devices**, **Devices** and choose **Update firmware**. Use Chrome or Edge on a computer, and plug the robot in with a USB-C data cable. Home can save a backup first. When it finishes, unplug the robot and plug it in again.

Most improvements come with a Home update. They need no new robot software. Update the firmware only when Home says so.

## See which software a robot has

Open the robot in **Settings**, **Apps and devices**, **Devices** and look under **Software**. Home shows the firmware version it last wrote, the version ready to install, and whether an update is ready. It also shows the Bot software running on this computer and whether it needs a restart.

Home records the firmware version when the robot checks in. It also shows whether the robot is online, when it last checked in, its network address, Wi-Fi signal and battery level. A check-in arrives about once a minute. If the robot is offline, check that it is on and joined to the same Wi-Fi network as the Home computer.

## A robot's settings

Open the robot from **Settings**, **Apps and devices**, **Devices**. The **This robot** card holds its name, voice, face color and night mode. It also sets how long the robot listens for a follow-up and how much its camera watches. The **Companion and controls** card sets how it talks and what it may say.


### What the robot's camera remembers

A robot with its camera on can tell you what it sees, such as "a person, three chairs and a tv, and it is bright in here." It keeps only a short list of the kinds of things it saw, with counts, colors and the light. It forgets each kind 90 seconds after it last saw it. It never keeps the picture, and it never writes the list down anywhere, so nobody can read it back later. When you ask it about something, such as a car, it can say the color or a guess at the make. It does not describe people beyond how many there are, and it does not say who anyone is. To let it name things, install the **Look** part under **Settings**, **AI and models** (find **Models and storage**) (it is about 4 MB); without it, the robot describes the room in one sentence instead. To change how much it watches, open the robot in **Settings**, **Apps and devices**, **Devices** and change **Robot camera watch level**. It can be off, presence only, or identify.
## Choose a robot's companion

An owner or admin picks how a robot talks. Open the robot and look for **Companion and controls**.

1. **Controls** is child, teen or adult. It decides what the robot may say to anyone who talks to it. A robot set to child always keeps child-safe answers, whatever companion it uses. Set a child's robot to child.
2. **Companion** is the personality. Most companions are for everyone and fit the robot's controls. A few are only for teens or adults. The list shows only the ones the controls allow.

A robot with no companion answers with child controls.

If you pick a companion the controls do not allow, Home says so and tells you what to do. To lower a robot's controls, change its companion first.

## Choose a robot's voice

The **Voice** row on the **This robot** card decides how the robot sounds.

- **Use the companion's voice** is the default. That is the voice an admin picked for the companion on the Synths page. If none was picked, it is Home's default voice.
- Pick any voice from the list to give this one robot its own voice. It wins over the companion's voice.

A robot set to child or teen can use any voice in the list, including a voice made from a recording. Everything it says still follows the same safety rules for a child or teen.

To rename a voice you made, open **Settings**, **Voice**, **Voices**, find the voice, and choose **Rename**.

For what the robot does, its lights, touch and voice commands, see the StackChan guide in the Bot repository.

## Timers, alarms and announcements on a StackChan

When you talk to a StackChan, you can ask it for a timer or an alarm. Say "set a timer for ten minutes", "wake me up at 7", "how long is left", "cancel my timer", "stop the timer" or "snooze five minutes". The timer lives on the robot itself, so it still rings if Home is off. The robot answers from what the body said back, so "Timer set for 10 minutes" means the body confirmed it. If it did not confirm, Home says it only asked.

If the robot is not a StackChan, is not connected, or has **Timers and alarms on this robot** turned off, the ask goes to Home's own timers and reminders instead, and the alarm rings where Home rings it.

Adults can also ask Home to speak through a robot: "tell the kitchen robot dinner is ready". The robot shows the card and says it. It holds a normal announcement back at night, in quiet hours, when muted, or when **Announcements from Home** is off, and Home tells you which. Say it is urgent to get it said at night. Children and teens cannot send announcements.
