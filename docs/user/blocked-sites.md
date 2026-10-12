---
title: Blocked sites
description: How MaiPai keeps web search away from adult, scam and harmful sites, and how to choose which lists it checks.
---

# Blocked sites

When MaiPai searches the web, it can check each result against lists of sites that are known to be bad. A site on a list you have turned on never reaches the answer. This page says what the lists are, where they come from, and how to pick them.

## What is blocked for whom

- Adult sites are always blocked for people using child or teen controls. Nobody can turn this off.
- Child controls start with gambling, scam, phishing, malware and drug sites blocked too.
- Teen controls start with gambling, scam, phishing and malware sites blocked.
- Adult controls start with no lists. You can add any of them.

## Choose the lists

Only an admin can change these.

1. Open **Settings**, then **Home**, then **Search**.
2. Find the **Blocked sites** card. It has a row for each kind of site (adult, gambling, scam, phishing, malware, drugs) and a column of boxes for **Kids**, **Teens** and **Adults**.
3. Tick a box to block that kind of site for that group, or clear it to allow it. Each tick saves on its own.

The adult sites boxes for Kids and Teens are ticked and greyed out. Nobody can clear them. If a tick does not save, the card says so; check your connection and tick the box again.

Each row also shows a line like "Updated 3 days ago, 4 lists, about 1.1 million sites blocked." It tells you the lists are fresh. It never shows which sites were blocked or what anyone searched for.

## Web search waits for the lists

MaiPai downloads each list once, then checks for a newer one about once a day. Web search for child and teen controls stays off until every list checked for them has downloaded. If your home has no internet at first start, answers come from the offline library until it does. When a list is still loading, the answer says it could not look online yet. Nothing else breaks.

## Your own block and allow lists

Under the grid, in **Show 8 advanced settings**, you can type your own sites, separated by commas, like example.com. A site you list also covers its pages and subdomains.

- **Always block these sites** hides a site from web search. Use the household row for everyone, or a row for child, teen or adult accounts to block it for that group only. A group's row adds to the household row, it never replaces it. A site you block is always blocked. Nothing overrides it.
- **Allow these sites** lets web search show a site that one of the optional lists blocks, such as a gambling or scam list. It never lets through an adult site for child or teen controls, and it never lets through a site you blocked yourself.

Only an admin can change these rows. They are the same for everyone in the group.

## Where the lists come from

The lists come from [The Block List Project](https://github.com/blocklistproject/Lists), a volunteer project that shares its lists under the Unlicense, which lets anyone use them. MaiPai does not copy the lists or host them. Your hub downloads each one straight from the project's page on GitHub, and checks that the file is the exact one MaiPai's signed catalog lists before using it. Nothing about you or your searches is sent in that download.

Thanks to the volunteers who keep these lists up to date.

## Lists can be wrong

A list is a long guess made by other people. Some good sites get blocked, and some bad sites get through. SafeSearch, and the other protections for children and teens, still apply on top of the lists.
