---
title: The news shelf
description: How MaiPai keeps a shelf of recent headlines for the news answer, and how to choose which news lists each person sees.
---

# The news shelf

When you ask MaiPai for the news, it does not go and fetch it at that moment. Instead, it keeps a small shelf of recent headlines, and a quiet background job refills the shelf a little at a time. Asking for the news reads the shelf. This page says how the shelf works and how to choose what goes on it.

## What is on the shelf

Headlines: a title, the name of the news site, a link, a short summary and the address of the picture the feed named. MaiPai opens an article, or fetches a picture, only when someone looks at that story on their own screen, never in the background. See [News](news.md) for reading and saving stories.

The headlines come from lists of news feeds. Two lists come with MaiPai:

- **Household news feeds** are public news sites for teens and adults, grouped by topic.
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

1. Open **News**, then its gear, then **News shelf**.
2. Find the **News shelf** card. It has a row for each list and a column of boxes for **Kids**, **Teens** and **Adults**.
3. Tick a box to show that list to that group, or clear it to hide it. Each tick saves on its own.

A dash instead of a box means the list is not offered to that group, and it cannot be turned on there. If a tick does not save, the card says so; check your connection and tick the box again.

To turn the whole shelf off, open **Show advanced settings** under the card and clear **News shelf**. With the shelf off, the news answer goes back to fetching the news live from one public news site each time you ask.

## Choose the topics people follow

Teens and adults start out following every topic: World, Local, Business, Technology, Science, Health, Sports, Entertainment and Environment. Each person can unfollow any topic on their own **Following** page, and it stays unfollowed. Children start out following none.

An admin can change the starting topics for each group. Open **News**, then its gear, and find **Topics followed by default for teen**, **for adult** and **for child**. Tick the topics that group should follow. A topic that a person already unfollowed stays unfollowed when you change this.

Each topic fills from the feeds that cover it. Local has no feed of its own, because it depends on where you live. To fill Local, add your town's news feed in **Extra news feeds**, below.

## Add or remove your own feeds

In the same **Show advanced settings** area there is a box for each group, named **Extra news feeds for child**, **for teen** and **for adult**. Type feed addresses starting with https://, separated by commas or spaces. Delete an address to remove that feed.

- Addresses for child are only ever read by children. Addresses for teen are read by teens and adults. Addresses for adult are read by adults only.
- An address that does not start with https://, or points at a place inside your home network, is refused, and the box tells you which one to fix.

The same area has **News poll interval** (how often MaiPai checks for new headlines; the default is every 30 minutes, and never faster than every 15) and **News retention** (how many days it keeps headlines).

## What leaves your house

For each feed, your hub asks the news site for its list of headlines, at most once every 15 minutes, one site at a time, and it says honestly who it is. If a site is slow, or says "not now", the hub waits longer before it asks again, up to a day. If nothing has changed since the last visit, the site sends back almost nothing. Nothing about you, your questions or who asked is sent. The **Privacy** page lists every news site the shelf talks to.

## Lists can be wrong

A feed is chosen by people and its content is written by someone else. A headline may be sad, wrong, or not a good fit for the person reading it. The checks for children and teens still apply on top of the lists.


## How My Mix learns

My Mix is for teens and adults. It uses only your own news reading on this hub. Opening a story adds a small signal.
Finishing or saving a story you opened adds more. **More like this** adds weight to its topics and source.
**Less like this** lowers their weight and cuts their story scores in half for 30 days. Older reading counts less.
No model scores your reading, and your reading is not sent to a news site. Other people, including admins, cannot see it.

My Mix is on by default for teens and adults. Turning it off hides its tab and stops learning. Children never get My Mix.
Their news still comes only from the Kids' lists.

**Reset My Mix** forgets what it learned and clears your reading history and feedback for News. Your follows and saved
stories stay. Stories you opened may look unread again. My Mix starts again from your follows and new reading.

The News app pages and these controls ship with the News app package. The shelf settings above work without that package.

## Keep full stories ready

An admin can turn on **Load News stories ahead of time** in the News settings, under advanced options. It is off by default. With it off, Home loads a story page only when someone opens or saves it.

When it is on, Home loads text from followed channels and the top stories in Today while nobody is using MaiPai. It tries each item only once. It loads at most one page every 30 seconds and 150 pages per site in 24 hours. It follows each site's rules for automated readers. If a site blocks a request, Home pauses these background reads for at least an hour. More failures make the wait longer, up to a day. You can still open a story yourself.

This switch never loads pictures in the background. Children still get only the Kids' sources. Each sentence is checked again before a child sees or hears it. No reading history or follow list is sent to the publisher.
