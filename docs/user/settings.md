---
title: Settings
description: Find your way around MaiPai's settings, for the household and for you.
---

Settings has one column grouped into **Yours** and **The home**. Your personal pages are available to you; household pages are available to an owner or admin and apply to everyone at home. Choose a page from the column, then use its tabs to move between related settings.

## The home group

- **System**: your household's language and region. Also how long backups and conversation history are kept.
- **AI model tuning**, **Integrations**, **Notifications**, **Hugging Face token**: advanced options for MaiPai's models and connections.

Under **Manage**, open **Users** to add, edit, or remove household members; **AI models** to choose models; **Backups** to run or review backups; **Repairs** to check and fix issues; **Updates** to see what is available; and **Privacy** to review connections. See [People and parental controls](people.md) for account details.

## Reach Home away from home

An owner or admin can open **Home**, then **Network**, and choose **Set up away access**. Home guides you through installing and signing in to Tailscale, enabling its secure addresses, and opening Home on a phone or tablet. The same setup is available from the setup checklist.

Until away access is enabled, Home works only on your home network. Tailscale connects your family's devices privately. Turning on Home's secure address publishes this computer's Tailscale name in public certificate logs. Choose a plain computer name, not a family name. This setup uses Tailscale's DNS and HTTPS certificate service; Headscale is not supported.

## Clear saved online data

An owner or admin can open **Manage**, then **Storage**, to see saved copies Home fetched for weather, news, and other lookups. Clear one source or choose **Clear all**. This does not clear chats, memories, or items in the news shelf. Home fetches a cleared copy again the next time someone asks. If a service is taking a break, Home may wait before trying it again.

## Your own settings

Choose a page in the **Yours** group for your own personal preferences:

- **Appearance**, **Personality**, **Voice**: how MaiPai looks and sounds when it talks to you.
- **Look**: pick the color scheme of the whole app. Neutral is the standard look, black and white, the same as the design it comes from. Navy is MaiPai's own blue-black set. The other six are ready-made color sets (Stone, Zinc, Mauve, Olive, Mist, Taupe). Light and dark mode both follow whichever one you pick.
- **On this device only**: choose a light, dark, or system appearance for this browser. This device choice takes precedence over your personal Appearance setting; reset it to use your personal setting again. It is stored only in this browser and is not synced.
- **My notifications**: how you're notified. This includes linking your own Telegram chat.
- **Voices**: pick a speaking voice and test it.
- **PIN / password**: change how you sign in.
- **Your name**: change the name MaiPai calls you. It shows on your messages everywhere.
- **Commands**: teach MaiPai a phrase of your own. For example, "when I say movie night, dim the lights."
- **Devices & sessions**: see what's signed in as you. Sign out anything you don't recognize.

## Voices

Open **Settings**, choose the **Yours** group, then choose **Voices**. Pick a voice from the **Voice for you** list and press **Test** to hear a short sentence. Press **Stop** to end it. Your choice is saved as soon as you pick it, and Home uses that voice in chat and when it reads text aloud.

If you have more than one microphone, the page also has a **Microphone** choice, remembered on this device only.

Children cannot change their own voice. An owner or admin opens **Voices**, uses **Choose a voice for**, and picks the child. Teens and adults choose their own. No one else can change it for them.

If the page says "Voices are still getting ready", wait a minute. After setup the voice engine needs a short time to start. If it says "Home can't reach its voice service", open **Repairs**, then come back and press **Try again**. See [Talking to Home](voice.md) for natural speech sounds and microphone help.

## Models and storage

An owner or admin opens **Settings**, **Engines and AI**, and scrolls to **Models and storage**. It lists every part of the AI on this computer, such as the chat models, the voices, the picture and video models and the picture tools. Each row shows how much space it uses, when it was last used and what uses it. The top line shows how much room is left. A part Home recommends but did not install, such as Detailed videos on a Mac that was upgraded, says "Recommended, not installed" and has an **Install** button. Home never downloads it for you after an upgrade. The LTX Detailed video model is optional. It needs a Mac with 128 GB of memory and about 74 GB of disk space. Its licence is free under 10 million dollars of yearly revenue. You accepted the licences of everything Home installs once, in setup (or with the single **Accept the licences for the AI models Home installs** prompt at the top of this section on a Home set up earlier), so a part never asks for its own accept. Once the licences are accepted, an **Install the recommended extras** button appears while any recommended extra is missing. A licence that is new, or whose terms changed, asks once, in plain words.

Press **Install** to download a part. A bar shows how far it has got, and you can keep using Home while it downloads. If there is not enough room, or this computer is too small to run it, the button is off and the row says why. Press **Uninstall** to remove a part. Home tells you how much space it frees and that you can install it again later. Chat keeps at least one model: the model chat is using, and the only chat model, cannot be removed.

If a download stops, the row says why and offers **Try again**. The same item is also in **Repairs**.

### Assistant access

An owner or admin can let an assistant, such as Claude Code, change a few settings for them. Open **Settings**, **Engines and AI**, and find **Assistant access**. Press **Make an assistant key**, name it, choose how long it lasts (7, 30 or 90 days) and copy the key when Home shows it. Home shows it only once. Give the key to the assistant. It can change only the short list of settings Home allows, today how Home helps the chat remember to search the web, and nothing else: it cannot change people, passwords, safety rules or ages. It stops working on its end date, when you revoke it here, or if the person who made it is no longer an owner or admin.

### Choosing which chat model answers

An owner or admin can pick the chat model. Open **Settings**, then **AI models**, and look at the **Chat models** card. Each model lists what it is good at and what it costs, plus its size. The one answering now says **In use**. For another model, press **Download** and wait: the progress bar at the top shows it, and the family keeps chatting while it downloads. When it finishes, the button changes to **Use this model**. Press it and Home switches in about a minute. If the model cannot start, the card says why and the old model keeps answering. Your choice stays after a restart. To go back, press **Use this model** on the earlier one.

Qwen3.6 35B A3B is the first model offered beside the default. It starts answering almost at once, because it can skip the thinking step, and it reads the pictures you send. It is a big download (about 22 GB) and is meant for a computer with 64 GB of memory or more.

Qwen3.6 35B A3B Uncensored is a second optional model, marked with an **Uncensored** badge. It is a version of the same model with its own refusals removed, so it answers what an adult asks. It also reads pictures, and it is about a 21 GB download. Home's age and safety rules still apply in front of it, so children's chats are not changed. It is never downloaded unless you choose it. You can pick it on the **AI & Models** overview (open the Chat row's gear and choose **Uncensored chat AI**, then **Apply changes**), or press **Download** in the **Advanced** tab. Picking **Standard chat AI** there puts the usual model back.

## Pictures, videos and music

An owner or admin opens **Settings**, **Pictures, videos and music**. It has the picture model (install or see it), who can make pictures, the style library, and the same for videos. Children can make cartoons by default. See [cartoon controls](people.md#cartoon-pictures-and-videos) to change this. See [Pictures](pictures.md) and [Videos](videos.md).

**Picture quality** and **Video quality** choose Quick or Detailed when nobody asks for a kind. **Song length** chooses quick or full songs. Quick songs are about 45 seconds and take under a minute. Full songs are about 3 minutes and take a minute or two. See [Songs](songs.md).

## Web search settings

An owner or admin opens **Settings**, **Search**. The **Web search** block holds the SearXNG address with **Test** and **Save**, the source switches and the teen and child DuckDuckGo choice. See [Set up web search](web-search.md).

## Find a setting fast

Use the **Search settings** box at the top of the page. It jumps you straight to what you're looking for.

![Settings, showing a household settings page](../assets/screens/settings-desktop-light.png)

## Still need help?

If a setting won't save, or you can't find one you expect, see [Fix a problem](fix-a-problem.md).
