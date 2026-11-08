<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/getmaipai/.github/main/brand/maipai-home-logo-dark.png">
    <img src="https://raw.githubusercontent.com/getmaipai/.github/main/brand/maipai-home-logo-light.png" alt="MaiPai Home" width="360">
  </picture>
</p>

<h3 align="center">Free AI that runs on your own hardware, in one private home for your whole family.</h3>

<p align="center"><a href="#install">Quick start</a> · <a href="docs/site-fumadocs/content/docs/user/index.mdx">Documentation</a> · <a href="CHANGELOG.md">Releases</a></p>

Your own private AI at home, with chat, voice, pictures and videos, on your own hardware - for protection, privacy, and independence.

Chat, music, pictures, video, podcasts, books and your smart home share one memory, one Library and one set of family profiles. Nothing is sent to a cloud service to make any of it. Features marked *Preview* work but have rough edges. Features marked *Planned* are not built yet.

## What you can do

### Music

- **Create a song.** Describe it, pick lyrics or instrumental, Quick or Full. Lyrics are timed and highlighted word by word as it plays.
- **Create a band.** Name, look and sound, with pictures drawn for you.
- **Create an album.** A title, a cover and the songs, made in chat or in Create.
- **Make a new song with an existing band.** On any playing song, press **Song like this** or **Band like this**.
- **Use an existing singer.** Sing a song of yours in another voice, using a household voice with a saved sample.
- **Make a cover or remix.** Bring your own audio file, or pick a song you made, and change its style, words, tempo or voice.
- **Split any song into stems.** Vocals, drums, bass and other, on your own computer.
- **Make sound effects and loops.** Type a sound, take up to three versions, loop it, and add it to a song.
- **Stream your own library.** Albums, artists, playlists, radio from your music, internet radio, and an optional DJ that speaks between songs.
- **Create a singer.** *Planned.*

### Pictures

- **Make a picture** from a description, with variations and styles (LoRAs).
- **Edit a picture.** Remove background, Erase, Upscale, Resize, Markup, or describe a change in words. Faces stay the same.
- **Ask about a picture.** Attach a photo and chat about it.

### Video

- **Make a video** from words, or **make a picture move**.
- **Continue a clip** from where it ended, then trim, join and add voice lines and songs in the Studio.
- **Make a film** from several clips, and **add captions** you can fix, translate and burn in.

### Chat

- **Chat with memory** you can see, correct or erase, with sources shown.
- **Search the web** with DuckDuckGo or your own SearXNG.
- **Work on hard problems** with one large model an admin allows, or code in a private coding workspace.
- **Pick a companion**, or @mention another for one question.

### Voice

- **Talk and listen** with natural speech, small laughs and sighs included.
- **Add a voice-over** to any clip, in a household voice.
- **Wake Home with a word.** *Preview.*

### Podcasts, shows and synths

- **Cast synths in a show.** A synth is an AI being with a name, a personality, a voice and a life. A news briefing is the first format. *Preview: the finished audio mix waits on the next engine update.*
- **Follow podcasts and radio.** Queue, save, and pick up where you stopped.
- **Watch shows and films, read books, listen to audiobooks** from your own collection.
- **Talk through your documents** as a spoken discussion. *Planned.*

### Documents and Library

- **Write a document** in chat and keep working on it beside the conversation.
- **Keep everything in one Library.** Pictures, videos, songs and files, with sharing and a trash you can restore.
- **Look things up in your own reference library.** Wikipedia and books, with pictures in answers.

### Home and family

- **Run the house.** Reminders, lists, alarms and timers, plus lights and locks through Home Assistant.
- **Read the news and weather** you chose, for your places.
- **Give everyone a profile.** Children are restricted by default and teens get more privacy. The safety gates cannot be switched off.
- **Speak your language.** English (US or UK) or Spanish, per person.

## Similar tools

Each row compares one feature, not the whole product.

| Feature in Home | Familiar tool |
|---|---|
| Create a song, album or band | Suno, Udio |
| Split into stems, remix a song | LALAL.AI, Moises |
| Sound effects | ElevenLabs sound effects |
| Make and edit pictures | Midjourney, DALL-E, Photoshop generative fill |
| Make and continue video | Runway, Sora |
| Chat with memory | ChatGPT, Claude |
| Web search with sources | Perplexity |
| Spoken shows with cast synths | NotebookLM audio overviews |
| Your own music, radio and podcasts | Spotify, a podcast app |
| Books and audiobooks | Audible, Calibre-Web |
| Library for pictures and files | Google Photos, iCloud |
| Companions | Character.ai |
| Reminders, lights and locks | Alexa, Google Home |

## Private by design

Nothing leaves your home unless you ask for it. The things that do go out are ones you start: web searches, weather lookups, a word or place lookup, downloads of models and updates, and a daily check for a new release. The privacy page in Settings lists every one and what it sends. There is no tracking, no crash reporting and no training on your family's words.

## Install

On the Mac that will run Home, open Terminal and run:

```bash
curl -fsSL https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.sh | sudo bash
```

Home is up in about a minute. Open the address it prints and the setup wizard installs the AI engine. Steps, upgrade, rollback and uninstall: [Install, upgrade, uninstall and fix](docs/user/install-upgrade-uninstall.md).

**What you need.** A Mac for chat, voice and music. Reading pictures needs 32 GB of memory or more. Making video needs a Mac with 128 GB. Each feature's guide page lists what it needs. This is an early release (0.2.x), first tested on a Mac Studio, so read the [changelog](CHANGELOG.md) before you upgrade.

## Documentation

| Guide | For |
|---|---|
| [User guide](docs/site-fumadocs/content/docs/user/index.mdx) | Everyone in the house. Short pages, one task each. |
| [Admin guide](docs/site-fumadocs/content/docs/admin/index.mdx) | The person who runs the house: setup, settings, backups, support. |
| [Developer guide](docs/site-fumadocs/content/docs/developers/index.mdx) | Contributors: architecture, building, reference. |

Contributing starts in the Developer guide. `scripts/check.sh` is the gate; it needs a sibling checkout of `getmaipai/.github`.

---

MaiPai is open-source software for personal, self-hosted, non-commercial
use by you and your household. It is not affiliated with, endorsed by, or
sponsored by any platform it can connect to or any product named above.
All product names and trademarks belong to their respective owners. You
are responsible for complying with the terms and laws that apply to you
and the services you access.

The AI in this product runs on third-party models you choose to
download. What they say can be wrong, offensive, or harmful; it is not
medical, legal, or professional advice; and you are responsible for
how you use it. Parents decide what children in the household can
reach.

Licensed under [AGPL-3.0](LICENSE).
