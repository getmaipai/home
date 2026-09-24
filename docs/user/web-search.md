---
title: Set up web search
description: How to connect MaiPai to your own SearXNG search server.
---

# Set up web search

## What web search needs

MaiPai asks your own search server, called SearXNG, so your questions go to it and not to one big company. You or a techy friend runs SearXNG on a computer at home.

## Get SearXNG ready

1. Use SearXNG's direct address, like `http://192.0.2.10:8888`. Do not use an address that shows a login page first. MaiPai cannot log in, so it gets no results.
2. Turn on JSON results. In SearXNG's `settings.yml`, under `search:`, set `formats: [html, json]`. Without it SearXNG answers MaiPai with an error.
3. Let MaiPai past SearXNG's robot check. Add the MaiPai computer's address to `pass_ip` in SearXNG's `limiter.toml`. If a firewall sits in front of SearXNG, allow that address there too.
4. Give SearXNG its own secret key. Set `secret_key` in `settings.yml`.
5. If SearXNG's computer has no working IPv6, turn IPv6 off there. If you do not, every search times out.
6. Restart SearXNG after each change.

## Connect MaiPai

Open Settings, find Web search, paste the address, and save.

## Kids and safe search

MaiPai picks the safe search level for each person. It uses strict for kids, moderate for teens, and off for adults. An adult can change it for anyone on their profile. SearXNG's own setting only affects other apps.

## If search stops working

MaiPai shows it on the repairs list. The most common cause is the search sites pausing your server for a while after too many searches. They come back on their own, usually within a few hours. MaiPai searches slowly on purpose so this rarely happens.

## Keep SearXNG up to date

Update it regularly. If your update runs as the admin user but SearXNG's files belong to SearXNG's own user, git refuses to update until that folder is marked safe. Run `git config --add safe.directory <folder>` to mark it.
