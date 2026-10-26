<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/getmaipai/.github/main/brand/maipai-home-logo-dark.png">
    <img src="https://raw.githubusercontent.com/getmaipai/.github/main/brand/maipai-home-logo-light.png" alt="MaiPai Home" width="360">
  </picture>
</p>

<h3 align="center">A private, self-hosted AI hub for families.</h3>

<p align="center"><a href="docs/site-fumadocs/content/docs/user/index.mdx">Documentation</a> · <a href="docs/user/install-upgrade-uninstall.md">Install</a> · <a href="CHANGELOG.md">Releases</a></p>

Your own private AI at home, with chat, voice, pictures and videos, on your own hardware - for protection, privacy, and independence.

Your chats, people and memories stay in your house. Home goes online for downloads, updates, web searches and other lookups you start. The privacy page lists what each feature sends.

## What Home does today

- **Private chat with memory.** Talk to an AI that runs on your own computer. It remembers what matters, shows its sources, and lets you see, fix or forget any memory.
- **Reads your pictures.** Attach a photo and ask about it. This needs a computer with 32 GB of memory or more.
- **Makes pictures and short videos.** Adults can ask for a picture, make variations, and add styles (LoRAs). Videos are up to 5 seconds and need a Mac with 128 GB of memory. Everything is made on your computer.
- **Edits pictures.** The Edit button opens an editor with Remove background, Erase, Upscale, Resize, Markup, and Comment (describe a change in words).
- **Natural voice.** Talk and listen. Home speaks with Chatterbox Turbo on bigger computers, and can add small laughs and sighs. An owner or admin can turn that off.
- **Web search.** Home searches with DuckDuckGo, or with your own SearXNG. Teens and children use your own SearXNG unless a grown-up allows more.
- **Weather.** A Weather app and a weather card in chat, with your places and your choice of Fahrenheit or Celsius.
- **Music and songs.** Browse your music library, make songs in chat, and follow the lyrics in the player.
- **News.** Read stories from the same news shelf Home uses for headline questions.
- **Companions.** Choose how chat sounds, make a companion, or ask another companion with an @mention.
- **Coding mode.** Give an adult a local coding workspace with personal keys.
- **Phone layout.** Apps use a bottom section bar and share the top bar with Home.
- **Pictures, videos and songs share a household queue.** Home shows each job's place in line while it waits.
- **Answer choices.** Adults can tap a choice below a question instead of typing it.
- **A Home page** with an ask box, a Today row, and Getting started steps.
- **Apps as packages.** A package can be an app with its own pages and settings. Weather is the first.
- **A real household.** One profile per person. Children are restricted by default, teens get more privacy, and the safety gates cannot be switched off.
- **Sign-in with passcode boxes.** One box per digit, a lockout after repeated wrong tries.
- **Backups and updates** you start yourself.
- **A one-line installer** for a Mac. It opens the setup wizard in your browser, and Home works in Chrome and Safari.

## Coming soon

Not shipped yet: a faster chat engine (oMLX) for 64 GB and 128 GB Macs, pictures and videos for children and teens, videos, podcasts, maps and the Go app.

## The privacy promise

Nothing leaves your home unless you ask for it. The things that do go out are ones you start: web searches, weather lookups, a word or place lookup, downloads of models and updates, and a daily check for a new release. The privacy page in Settings lists every one and what it sends. There is no tracking, no crash reporting and no training on your family's words.

## Read the guides

| Guide | For | Start here |
|---|---|---|
| **User guide** | Everyone in the house. Short pages, one task each. | [Open the User guide](docs/site-fumadocs/content/docs/user/index.mdx) |
| **Admin guide** | The person who runs the house: setup, settings, backups, support. | [Open the Admin guide](docs/site-fumadocs/content/docs/admin/index.mdx) |
| **Developer guide** | Contributors: architecture, building, reference. | [Open the Developer guide](docs/site-fumadocs/content/docs/developers/index.mdx) |

## Status

Early release (0.2.x). The first full install runs on a Mac Studio. Expect rough edges, and read the [changelog](CHANGELOG.md) before you upgrade.

## Install

On the Mac that will run Home, open Terminal and run:

```bash
curl -fsSL https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.sh | sudo bash
```

Home is up in about a minute. Open the address it prints and the setup
wizard installs the AI engine if this computer runs the AI. Steps,
upgrade, rollback and uninstall:
[Install, upgrade, uninstall and fix](docs/user/install-upgrade-uninstall.md).
For running from source, see the Admin guide's
[install and start](docs/site-fumadocs/content/docs/admin/install-and-set-up/install-and-start.mdx).

## Contributing

The [Developer guide](docs/site-fumadocs/content/docs/developers/index.mdx)
is the front door. `docs/dev.md` is the long design record and
`scripts/check.sh` is the gate; it needs a sibling checkout of
`getmaipai/.github`.

---

MaiPai is open-source software for personal, self-hosted, non-commercial
use by you and your household. It is not affiliated with, endorsed by, or
sponsored by any platform it can connect to. All product names and
trademarks belong to their respective owners. You are responsible for
complying with the terms and laws that apply to you and the services you
access.

The AI in this product runs on third-party models you choose to
download. What they say can be wrong, offensive, or harmful; it is not
medical, legal, or professional advice; and you are responsible for
how you use it. Parents decide what children in the household can
reach.

Licensed under [AGPL-3.0](LICENSE).
