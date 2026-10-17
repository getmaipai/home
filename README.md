<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/getmaipai/.github/main/brand/maipai-home-logo-dark.png">
    <img src="https://raw.githubusercontent.com/getmaipai/.github/main/brand/maipai-home-logo-light.png" alt="MaiPai Home" width="360">
  </picture>
</p>

<h3 align="center">A private, self-hosted AI hub for families.</h3>

<p align="center"><a href="https://github.com/getmaipai/home/releases">Releases</a></p>

Your chats, people and memories stay in your house. Home goes online only to do what you ask: downloads, updates and web searches.

## What you get

- **A private chat** with an AI that runs on your own hardware, with sources you can check.
- **A real household:** one profile per person, safe by default for children and private for teens.
- **Memory you control:** see what it remembered, correct it, or make it forget.
- **Backups and updates** you start yourself, and a privacy page that lists every outside connection.

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
