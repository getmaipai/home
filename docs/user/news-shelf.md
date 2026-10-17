---
title: The news shelf
description: How MaiPai keeps a shelf of recent headlines for the news answer, and how to choose which news lists each person sees.
---

# The news shelf

When you ask MaiPai for the news, it does not go and fetch it at that moment. Instead, it keeps a small shelf of recent headlines, and a quiet background job refills the shelf a little at a time. Asking for the news reads the shelf. This page says how the shelf works and how to choose what goes on it.

## What is on the shelf

Headlines: a title, the name of the news site, a link, a short summary and the address of the picture the feed named. MaiPai opens an article, or fetches a picture, only when someone looks at that story on their own screen, never in the background.

The headlines come from lists of news feeds. Two lists come with MaiPai:

- **Household news feeds** are public news sites for teens and adults.
- **Kids' news feeds** are news written for young readers, for children.

Old headlines are cleared out after a while, so the shelf never grows without end.

## What is shown to whom

- A child only reads from lists made for children.
- A teen or an adult reads from the household list.
- Every headline a child or teen would hear is checked again on the way out, the same as any other answer. If a headline does not pass, it is left out.
- A child or teen never gets a list that is not marked for them. Nobody can change this.

If no list is turned on for a person, MaiPai says so and points to Settings. If the shelf has nothing saved yet, it says that too and asks you to try again later.

## Choose the lists

Only an admin can change these.

1. Open **Settings**, then **Home**, then **Search**.
2. Find the **News shelf** card. It has a row for each list and a column of boxes for **Kids**, **Teens** and **Adults**.
3. Tick a box to show that list to that group, or clear it to hide it. Each tick saves on its own.

A dash instead of a box means the list is not offered to that group, and it cannot be turned on there. If a tick does not save, the card says so; check your connection and tick the box again.

To turn the whole shelf off, open **Show advanced settings** under the card and clear **News shelf**. With the shelf off, the news answer goes back to fetching the news live from one public news site each time you ask.

## Add or remove your own feeds

In the same **Show advanced settings** area there is a box for each group, named **Extra news feeds for child**, **for teen** and **for adult**. Type feed addresses starting with https://, separated by commas or spaces. Delete an address to remove that feed.

- Addresses for child are only ever read by children. Addresses for teen are read by teens and adults. Addresses for adult are read by adults only.
- An address that does not start with https://, or points at a place inside your home network, is refused, and the box tells you which one to fix.

The same area has **News poll interval** (how often MaiPai checks for new headlines; the default is every 30 minutes, and never faster than every 15) and **News retention** (how many days it keeps headlines).

## What leaves your house

For each feed, your hub asks the news site for its list of headlines, at most once every 15 minutes, one site at a time, and it says honestly who it is. If a site is slow, or says "not now", the hub waits longer before it asks again, up to a day. If nothing has changed since the last visit, the site sends back almost nothing. Nothing about you, your questions or who asked is sent. The **Privacy** page lists every news site the shelf talks to.

## Lists can be wrong

A feed is chosen by people and its content is written by someone else. A headline may be sad, wrong, or not a good fit for the person reading it. The checks for children and teens still apply on top of the lists.
