---
title: Privacy
description: See exactly what, if anything, leaves your house.
---

Your conversations, memories, and household profiles stay on this computer. MaiPai does not run a server that your family's information passes through, and nothing reports back to us about how you use it. A feature can send the small piece of information it needs directly to its own service, such as the place in a weather request or the word you want defined. The list below names every connection.

## See what leaves your house

Open **Privacy** in the sidebar. It lists every outbound connection MaiPai can make. For each one, you'll see:

- **When** it happens
- **What it sends**
- **Who receives it**
- **How long they keep it**

Anything not on this list does not happen. Most entries happen only when an adult chooses a download or turns on an optional feature. Other entries happen when someone asks for a service, such as weather, trivia, a joke, a definition, news, sports, music, web search, or a film or TV lookup. One daily check asks GitHub whether a new MaiPai Home release is available. One download happens on its own, with no one choosing it: the first time the hub needs its small memory helper (the model that decides what to remember and writes conversation summaries), it fetches that 1.7-gigabyte file from Hugging Face. Downloads send the file name and your home's internet address. They do not send anything anyone in the house said, asked, or saved.

An adult can also generate an API token for another app or device. This page shows that too, under its own heading. It is the one thing that goes the other way: an app or device you gave the token to can send text or audio to your hub over your home network and receive a reply. Revoking the token ends that access.

## What never leaves your house

Your conversations stay on this computer. So does everything MaiPai remembers, and every profile in your household. MaiPai does not collect usage stats or crash reports. Nothing your family says is used to train anything. Your browser saves a copy of MaiPai's own screens on this device so the app can still open without internet. That cache is same-origin only: it stores the app's own files, never anything you typed or anything MaiPai remembers.

![The Privacy page, listing every outbound connection MaiPai can make](../assets/screens/privacy-desktop-light.png)

## Still need help?

Something on this page can look unfamiliar. You might not be sure why a connection is listed. Either way, see [Fix a problem](fix-a-problem.md).
