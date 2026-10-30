---
title: Set up web search
description: How to connect MaiPai to your own SearXNG search server, use it away from home, and fix it when it stops working.
---

# Set up web search

## What web search needs

Web search works with no setup for adults. Home's own small search service reaches DuckDuckGo for them. You can also run your own SearXNG server. It is the main source for teens and children. MaiPai sends your search words to the source you chose. Home's own SearXNG, run by the AI engine, is planned (STACK-SEARCH-01).

The model decides when a question needs a search. You do not have to press a button.

If a search cannot reach your search server, the answer does not fail. MaiPai says it could not look the thing up, and it does not guess.

## What MaiPai reads and sends

When you search, MaiPai sends your search words to your SearXNG. It does not need a key or an account. Then MaiPai reads up to three of the pages that came back, one from each site, and answers from what they say. The answer shows numbered links to those pages. Each site sees a normal page request from your home's internet address, and never your question. Your SearXNG sends your search words to the search sites it is set up to use.

## Search the web from the Search box

The Search box (the magnifier, or Cmd+K) has a **Web** tab. Type your words, pick **Web**, then press Enter. Nothing is sent to the web until you press Enter, and typing on the other tabs never sends anything.

The Web tab uses the same sources and the same rules as a chat question. It shows each result's site, title and a short line from the site. It does not read the pages and does not show pictures. A result opens in a new browser tab when you press **Open**, and that site then sees your visit. A teen or a child sees only what their rules allow, and a search with a name, address, phone number, email or ID number in it is never sent. If web search is off, or your search server does not answer, the tab says so in plain words. Guests do not get the Web tab. Home does not save what you searched.

## Get SearXNG ready

1. Use SearXNG's direct address, like `http://192.0.2.10:8888`. Do not use an address that shows a login page first. MaiPai cannot log in, so it gets no results.
2. Turn on JSON results. In SearXNG's `settings.yml`, under `search:`, set `formats: [html, json]`. Without it SearXNG answers MaiPai with an error.
3. Let MaiPai past SearXNG's robot check. Add the address MaiPai connects from to `pass_ip` in SearXNG's `limiter.toml`. If a firewall sits in front of SearXNG, allow that address there too, and only that address.
4. Give SearXNG its own secret key. Set `secret_key` in `settings.yml`.
5. If SearXNG's computer has no working IPv6, turn IPv6 off there. If you do not, every search times out.
6. Restart SearXNG after each change.

## Connect MaiPai

1. Open **Settings**, then then **Search**. Only an owner or an admin sees this page.
2. Under **Web search**, paste the address into **SearXNG address**, for example `http://192.0.2.10:8888`.
3. Press **Test**. Home says in plain words whether the address works, with a **Recommended** line and a **Details** list. A warning still counts as working.
4. Press **Save**. **Save** stays off until the exact text in the box has passed a Test. If you change the address afterward, test it again.
5. Ask MaiPai a question you know the answer to, like "Search the web for the capital of France."

To stop using SearXNG, clear the address and press **Remove SearXNG**. Home asks first: it will use DuckDuckGo for adults (if it is set up) and the Library only for teens and children.

The line at the top of the Web search block says what web search uses right now, for example "SearXNG at 192.0.2.10:8888 works", "DuckDuckGo (adults only)" or "Library only".

## Add DuckDuckGo as a second source (optional)

SearXNG stays your main search. You can also add DuckDuckGo, and MaiPai blends both lists into one. If SearXNG could not be set up during setup, DuckDuckGo is turned on for you, and you can turn it off under **Settings**, **Search**. MaiPai sets up its small search service by itself, which can take a few minutes after install, and only adults use it unless you allow it for teens or children (below). Guests always use SearXNG alone.

1. Wait for the small search service to finish setting itself up. Until it does, a web question answers "Web search is still being set up on this computer." If it cannot, **Repairs** says why and has a **Try again** button.
2. Open **Settings**, **Search**, and check that **DuckDuckGo** is on under the address box. The switch appears once the helper runs, and it is on for you when SearXNG is not set up.

What it sends: the words searched and your home's internet address go to DuckDuckGo, from the service on your computer. Nothing else anyone in the house said or saved. It asks at a person's pace. If DuckDuckGo pushes back, MaiPai stops asking for an hour or more and answers from your other source meanwhile.

### Allow DuckDuckGo for teens and children (off by default)

Teens and children use SearXNG alone. An admin can change that. Once DuckDuckGo is running, open **Settings**, **Search**, and set **DuckDuckGo for teens and children** (under **Teens and children**) to **Teens** or **Teens and children**. Only an admin can change it.

Read this first. DuckDuckGo's own filter is not guaranteed, and the tool MaiPai uses to reach it often ignores the strict setting MaiPai asks for. Adult results may reach this age group. Leave this off unless you accept that.

When it is on, DuckDuckGo is a second source beside SearXNG, never the only one. MaiPai still asks for the strictest SafeSearch, blocks adult sites, checks the pages it reads and checks every answer. Searches spoken to a voice or robot still use SearXNG alone, and so do guests. A search with an email address, phone number or ID number in it is never sent, and a DuckDuckGo result from a blocked site or with an unsafe snippet is dropped, exactly as for SearXNG. If DuckDuckGo is not running on this computer, the setting shows a note and has no effect until it is. Until SearXNG is set up, teens and children use the Library only unless you turn this on.

## Using search when you are away from home

MaiPai runs on your computer at home, and that computer is the one that talks to your search server. If your search server is on the same home network, being away changes nothing.

It matters when the search server is somewhere else, for example at a relative's house or on a cloud machine. Then use your tailnet. A tailnet is the private network Tailscale makes between your devices. Pick one of these:

- **Put the search server on your tailnet.** Use its tailnet address in **SearXNG address**, like `http://100.64.0.10:8888`.
- **Use a Tailscale subnet router.** A subnet router is one device that shares a whole home network with your tailnet. Home can then reach the search server's normal home address.

Whichever you pick, the search server only answers an address it trusts. Check these:

- [ ] The computer that runs MaiPai is on the same tailnet, and Tailscale is running on it.
- [ ] The address you saved in **SearXNG address** works from the computer that runs MaiPai, not just from your phone or laptop.
- [ ] The address MaiPai connects from is in `pass_ip` in `limiter.toml`. With a subnet router, this may be the router's address and not MaiPai's own.
- [ ] Any firewall in front of the search server allows that same address.
- [ ] SearXNG was restarted after you changed anything.

## Where answers come from: Library only, Library first, Internet first

If you have installed the offline library (articles stored on your own computer), you choose how MaiPai uses it. Open **Settings**, then **Search**, then **Search sources**. There are three choices.

- **Library first** (the default). MaiPai checks the library first. If it has an answer, MaiPai uses it and sends nothing out of your house. If it has nothing, MaiPai searches the internet. When the question is about something recent, MaiPai can still ask the internet right away.
- **Internet first.** MaiPai searches the internet every time and shows the library's article next to the results when it has one.
- **Library only.** MaiPai never asks Wikipedia over the internet. Web search stays on, so it still uses your search server. To turn web search off as well, open the advanced options and set the web source to **Library only**.

Children and teens never use Wikipedia over the internet or the paid search service, in any of the three choices. Their web search keeps its safe search level.

What leaves your house when MaiPai asks Wikipedia: the words of the search go to Wikipedia, which is run by the Wikimedia Foundation. Wikipedia also sees your home's internet address, like any website you visit. This happens only for an adult, only when the web search found nothing and the library had no article either (or, in **Internet first**, when the web search found nothing).

If you turned off **Ask Wikipedia when web search fails or finds nothing** in an earlier version, MaiPai keeps that choice. Your Wikipedia source is set to **Library only**, and nothing else changes.

## Choosing which search engines answer

Open **Settings**, then **Search**, then **Web search sources** (an advanced option). SearXNG is picked by default. When you pick more than one source, MaiPai asks them all at once and merges the answers into one list. A page that two sources both find moves to the top, and the same page never appears twice. If one source fails, the others still answer.

You must keep at least one source picked. To turn web search off, set **Web searches** to **Library only** instead. DuckDuckGo only answers once its small search service is running (see Add DuckDuckGo as a second source). Children and teens use SearXNG alone unless an admin allows DuckDuckGo for them (see Add DuckDuckGo as a second source).

## Looking up a word online

**Look up words online** is off until an adult switches it on. Open **Settings**, then **Search**, then **Search sources**.

When it is on and an adult asks what one word means, MaiPai checks your offline dictionary first. If the dictionary has no entry for that word, MaiPai asks Wiktionary, an online dictionary. MaiPai only does this for a single word, never for a phrase.

What leaves your house: the one word goes to Wiktionary, which the Wikimedia Foundation runs. Wiktionary also sees your home's internet address, like any website you visit. Nothing else is sent.

Children and teens never use it. It also stays off when your search sources are set to **Library only**. If Wiktionary does not answer, MaiPai answers from your library and does not try again for a while.

## Saved pages and missing pages

MaiPai keeps a saved copy of the web pages it reads, so a page it read in the last week is not fetched again (a news site's page is kept for a day). The copies stay on this computer. Open **Settings**, then **Search**, and use **Search fetch cache limit (GB)** to set how much disk space they may use. When the limit is reached, the pages used least recently go first. Setting it to 0 turns saving off. A temporary chat never saves or reuses a page.

When a page that a search found has been taken down, MaiPai can show the Internet Archive's Wayback Machine copy instead and says that it is a copy, with its date. This is on by default. Turn it off with **Use archived pages when a source is missing** in **Settings**, then **Search**. Only the address of the missing page goes to the Internet Archive, which sees your home's internet address too. Children never get this, and it stays off when your search sources are set to **Library only**. Teens' copies pass the same safety check as any other page.

## Kids and safe search

MaiPai picks the safe search level for each person. It uses strict for kids, moderate for teens, and off for adults. An adult can change it for anyone on their profile. SearXNG's own setting only affects other apps.

## What an admin sees when search has a problem

An owner or admin can open **Settings**, then **Repairs**. Two search problems can show up there.

- **Web search can't reach your SearXNG instance.** This is an error. The line under it says what went wrong and ends with: "Check the SearXNG address in Settings, Search, Web search."
- **Web search isn't finding anything.** This is a warning. It means the search server answers, but its search sites are paused or blocked. The line under it says: "SearXNG reports its own search engines are currently suspended (too many requests, or a CAPTCHA) - this usually clears on its own within a while. If it doesn't, check which engines are enabled in SearXNG's own settings." A second version says a test search for "Earth" found nothing, and that SearXNG may be out of date.

On the status cards, a search that cannot be reached shows as "search isn't reachable", and a search that is struggling shows as "search is having trouble."

Each problem goes away by itself when search works again. MaiPai also runs a test search every 15 minutes.

## If search stops working

Go down this list in order.

1. **Is the search server running?** Open its address in a browser on the computer that runs MaiPai. You should see the SearXNG page.
2. **Is the address right?** Check **SearXNG address** in **Settings**, **Search**, and press **Test**. It needs `http://`, the right number after the colon, and no login page in front.
3. **Is Home allowed?** Check `pass_ip` in `limiter.toml` and your firewall for the address MaiPai connects from. Restart SearXNG.
4. **Is JSON on?** Check `formats: [html, json]` in `settings.yml`.
5. **Is the tailnet up?** If you reach the search server over Tailscale, make sure Tailscale is running on the computer that runs MaiPai.
6. **Try a known question.** Ask "Search the web for the capital of France." Then look at **Repairs**.

If Repairs says the search sites are paused, wait. They come back on their own, usually within a few hours. MaiPai searches slowly on purpose so this rarely happens.

## Keep SearXNG up to date

Update it regularly. If your update runs as the admin user but SearXNG's files belong to SearXNG's own user, git refuses to update until that folder is marked safe. Run `git config --add safe.directory <folder>` to mark it.
