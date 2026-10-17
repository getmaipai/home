---
title: Settings
description: Find your way around MaiPai's settings, for the household and for you.
---

Settings are split into two tabs at the top of the page. **Household** holds shared settings, usually owner or admin only. **Me** holds your own personal preferences.

## Household settings

- **System**: your household's language and region. Also how long backups and conversation history are kept.
- **AI model tuning**, **Integrations**, **Notifications**, **Hugging Face token**: advanced options for MaiPai's models and connections.

Under **Manage**, open **Users** to add, edit, or remove household members; **AI models** to choose models; **Backups** to run or review backups; **Repairs** to check and fix issues; **Updates** to see what is available; and **Privacy** to review connections. See [People and parental controls](people.md) for account details.

## Reach Home away from home

An owner or admin can open **Home**, then **Network**, and choose **Set up away access**. Home guides you through installing and signing in to Tailscale, enabling its secure addresses, and opening Home on a phone or tablet. The same setup is available from the setup checklist.

Until away access is enabled, Home works only on your home network. Tailscale connects your family's devices privately. Turning on Home's secure address publishes this computer's Tailscale name in public certificate logs. Choose a plain computer name, not a family name. This setup uses Tailscale's DNS and HTTPS certificate service; Headscale is not supported.

## Clear saved online data

An owner or admin can open **Manage**, then **Storage**, to see saved copies Home fetched for weather, news, and other lookups. Clear one source or choose **Clear all**. This does not clear chats, memories, or items in the news shelf. Home fetches a cleared copy again the next time someone asks. If a service is taking a break, Home may wait before trying it again.

## Your own settings

Switch to the **Me** tab for your own personal preferences:

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

Open **Settings**, choose the **Me** tab, then choose **Voices**. Pick a voice from the **Voice for you** list and press **Test** to hear a short sentence. Press **Stop** to end it. Your choice is saved as soon as you pick it, and Home uses that voice in chat and when it reads text aloud.

If you have more than one microphone, the page also has a **Microphone** choice, remembered on this device only.

Children cannot change their own voice. An owner or admin opens **Voices**, uses **Choose a voice for**, and picks the child. Teens and adults choose their own. No one else can change it for them.

If the page says "Voices are still getting ready", wait a minute. After setup the voice engine needs a short time to start. If it says "Home can't reach its voice service", open **Repairs**, then come back and press **Try again**. See [Talking to Home](voice.md) for natural speech sounds and microphone help.

## Pictures and videos

An owner or admin opens **Settings**, **Home settings**, **Pictures and videos**. It has the picture model (install or see it), who can make pictures, the style library, and the same for videos. Children and teens show as off. See [Pictures](pictures.md) and [Videos](videos.md).

## Web search settings

An owner or admin opens **Settings**, **Home settings**, **Search**. The **Web search** block holds the SearXNG address with **Test** and **Save**, the source switches and the teen and child DuckDuckGo choice. See [Set up web search](web-search.md).

## Find a setting fast

Use the **Search settings** box at the top of the page. It jumps you straight to what you're looking for.

![The Settings page, showing the Household tab's System section](../assets/screens/settings-desktop-light.png)

## Still need help?

If a setting won't save, or you can't find one you expect, see [Fix a problem](fix-a-problem.md).
