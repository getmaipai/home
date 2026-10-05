---
title: Set up web search
description: How to connect MaiPai to your own SearXNG search server, use it away from home, and fix it when it stops working.
---

# Set up web search

## What web search needs

MaiPai asks your own search server, called SearXNG. Your questions go to it and not to one big company. You or a techy friend runs SearXNG on a computer at home. Web search stays off until you give MaiPai its address.

The model decides when a question needs a search. You do not have to press a button.

If a search cannot reach your search server, the answer does not fail. MaiPai says it could not look the thing up, and it does not guess.

## What MaiPai reads and sends

When you search, MaiPai sends your search words to your SearXNG. It does not need a key or an account. Then MaiPai reads up to three of the pages that came back, one from each site, and answers from what they say. The answer shows numbered links to those pages. Each site sees a normal page request from your home's internet address, and never your question. Your SearXNG sends your search words to the search sites it is set up to use.

## Get SearXNG ready

1. Use SearXNG's direct address, like `http://192.0.2.10:8888`. Do not use an address that shows a login page first. MaiPai cannot log in, so it gets no results.
2. Turn on JSON results. In SearXNG's `settings.yml`, under `search:`, set `formats: [html, json]`. Without it SearXNG answers MaiPai with an error.
3. Let MaiPai past SearXNG's robot check. Add the address MaiPai connects from to `pass_ip` in SearXNG's `limiter.toml`. If a firewall sits in front of SearXNG, allow that address there too, and only that address.
4. Give SearXNG its own secret key. Set `secret_key` in `settings.yml`.
5. If SearXNG's computer has no working IPv6, turn IPv6 off there. If you do not, every search times out.
6. Restart SearXNG after each change.

## Connect MaiPai

1. Open **Settings**, then **AI & connections**, then **Integrations**.
2. Find **SearXNG URL**.
3. Paste the address, for example `http://192.0.2.10:8888`, and save.
4. Ask MaiPai a question you know the answer to, like "Search the web for the capital of France."

## Using search when you are away from home

MaiPai runs on your computer at home, and that computer is the one that talks to your search server. If your search server is on the same home network, being away changes nothing.

It matters when the search server is somewhere else, for example at a relative's house or on a cloud machine. Then use your tailnet. A tailnet is the private network Tailscale makes between your devices. Pick one of these:

- **Put the search server on your tailnet.** Use its tailnet address in **SearXNG URL**, like `http://100.64.0.10:8888`.
- **Use a Tailscale subnet router.** A subnet router is one device that shares a whole home network with your tailnet. Home can then reach the search server's normal home address.

Whichever you pick, the search server only answers an address it trusts. Check these:

- [ ] The computer that runs MaiPai is on the same tailnet, and Tailscale is running on it.
- [ ] The address you pasted in **SearXNG URL** works from the computer that runs MaiPai, not just from your phone or laptop.
- [ ] The address MaiPai connects from is in `pass_ip` in `limiter.toml`. With a subnet router, this may be the router's address and not MaiPai's own.
- [ ] Any firewall in front of the search server allows that same address.
- [ ] SearXNG was restarted after you changed anything.

## Wikipedia backup for adults

If your search server does not answer, or finds nothing, MaiPai can ask Wikipedia instead. This is on by default, but only for adults. Children and teens never use it.

What leaves your house: the words of the search go to Wikipedia, which is run by the Wikimedia Foundation. Wikipedia also sees your home's internet address, like any website you visit.

To turn it off, open **Settings**, then **AI & connections**, then **Integrations**, and turn off **Ask Wikipedia when web search fails or finds nothing**.

## Kids and safe search

MaiPai picks the safe search level for each person. It uses strict for kids, moderate for teens, and off for adults. An adult can change it for anyone on their profile. SearXNG's own setting only affects other apps.

## What an admin sees when search has a problem

An owner or admin can open **Settings**, then **Repairs**. Two search problems can show up there.

- **Web search can't reach your SearXNG instance.** This is an error. The line under it says what went wrong and ends with: "Check the SearXNG URL in Settings -> AI & connections -> Integrations."
- **Web search isn't finding anything.** This is a warning. It means the search server answers, but its search sites are paused or blocked. The line under it says: "SearXNG reports its own search engines are currently suspended (too many requests, or a CAPTCHA) - this usually clears on its own within a while. If it doesn't, check which engines are enabled in SearXNG's own settings." A second version says a test search for "Earth" found nothing, and that SearXNG may be out of date.

On the status cards, a search that cannot be reached shows as "search isn't reachable", and a search that is struggling shows as "search is having trouble."

Each problem goes away by itself when search works again. MaiPai also runs a test search every 15 minutes.

## If search stops working

Go down this list in order.

1. **Is the search server running?** Open its address in a browser on the computer that runs MaiPai. You should see the SearXNG page.
2. **Is the address right?** Check **SearXNG URL** in **Settings**, **AI & connections**, **Integrations**. It needs `http://`, the right number after the colon, and no login page in front.
3. **Is Home allowed?** Check `pass_ip` in `limiter.toml` and your firewall for the address MaiPai connects from. Restart SearXNG.
4. **Is JSON on?** Check `formats: [html, json]` in `settings.yml`.
5. **Is the tailnet up?** If you reach the search server over Tailscale, make sure Tailscale is running on the computer that runs MaiPai.
6. **Try a known question.** Ask "Search the web for the capital of France." Then look at **Repairs**.

If Repairs says the search sites are paused, wait. They come back on their own, usually within a few hours. MaiPai searches slowly on purpose so this rarely happens.

## Keep SearXNG up to date

Update it regularly. If your update runs as the admin user but SearXNG's files belong to SearXNG's own user, git refuses to update until that folder is marked safe. Run `git config --add safe.directory <folder>` to mark it.
