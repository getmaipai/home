---
title: Set up your hub
description: Walk through the one-time setup wizard the first time you open MaiPai Home.
---

The first time you open MaiPai Home, a setup wizard walks you through it. You do this once. It takes a few minutes, and the AI keeps downloading while you answer.

The installer opens the setup address in your browser for you. If it did not, it printed the address on its last line. Open that address on the Mac, or on any device on your home network.

## What you need

- A name and a PIN or password for yourself. You are the owner.
- A place to keep one small file: your backup key. Keep it somewhere other than this computer, like a USB stick or a password manager.

## The steps

The top of the wizard shows two parts: **Your Home** and **Your AI**. The screens go in this order.

1. **Welcome.** One line about what Home is. Press **Continue**.
2. **Before you start.** Four short notes you can open one at a time: the AI can be wrong, kids may still see things they should not, people can grow attached to AI, and Home goes online for downloads, updates and searches you ask for. Read them, then press **Continue**.
3. **How should Home run?** Pick **This computer** if this one machine runs everything. Pick **Another computer** if a bigger computer on your home network will run the AI. If you pick this computer, Home starts installing the AI engine right away.
4. **Choose where to store data.** Keep the defaults, or pick a folder of your own. Home tells you if it cannot use a folder and why.
5. **Tune this computer.** Optional. Home lists a few quick changes that help a Mac that runs all day, like keeping it awake. Press **Apply recommended** to make the ones Home can do itself. Anything that needs an administrator shows the exact line to paste in Terminal. Every change can be undone. Press **Skip this step** to leave it all alone.
6. **Checking your computer.** Home checks the computer and shows each result as ready, a thing to look at, or **Needs fixing**. It does not move on by itself. Fix anything marked **Needs fixing** and press **Try again**. If you picked two computers, the title says "computers" and both are checked.
7. **Your setup plan.** The plan lists what you get, including voice ("Voice: talk to Home"). Press **Install and continue**.
8. **Turn on web search.** You only see this screen when Home's own search is not ready. See [the web search step](#the-web-search-step) below.
9. **Create your owner account.** Type your name and choose a PIN or password. You type it twice. The two boxes turn green with "Passcodes match" when they agree, and red with a fix when they do not. A PIN or password can be 4 to 128 characters.
10. **Save your backup key.** If this computer breaks, this key restores your Home on a new one. Press **Download**. **Continue** unlocks after the download starts. The key can only be downloaded, not shown on screen.
11. **You're all set.** You can talk with Home as soon as you open it. If the AI is still downloading, chat starts answering when the first model finishes.

The old Face and Hello screens are gone. To have Home greet you by face, turn it on later in your profile.

## The install progress line

While the AI engine and models download, a single line near the bottom of the wizard shows the step it is on: fetch, build, start, then the downloads. After setup, owners and admins see the same line at the bottom of every page until the install finishes. If it stops, the line says what went wrong and has a **Try again** button.

## The web search step

Home needs a way to search the web. It has its own search service, and most of the time you never see this screen. When that service could not be set up, Home asks if you run your own SearXNG.

- If you do, paste its address, like `http://192.0.2.10:8888`, and press **Test**. The result is one plain sentence with a **Recommended** line. **Continue** turns on once the test for that exact address passes.
- If you do not, leave the address empty and press **Continue**. That turns on DuckDuckGo search for adults. Until SearXNG is set up, teens and children use the Library only. You can change this later in **Settings**. See [Set up web search](web-search.md).

## After setup

You land on the sign-in screen. Sign in as the owner, and see [Sign in](sign-in.md) and [The Home screen](home.md). The first time you use voice, your browser asks for the microphone. See [Talking to Home](voice.md).

## If a step will not finish

- A red box means Home could not do something. It says what went wrong and what to press next.
- If the checks keep failing, see [Fix a problem](fix-a-problem.md).
- To run the checks again later, open **Settings**, then **Repairs**.
