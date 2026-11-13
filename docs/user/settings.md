---
title: Settings
description: Find your way around MaiPai's settings, for you and for the household.
---

Settings has one column of pages. The top group is **Yours**, for your own choices. The next group is **The home**, for an owner or admin, and it applies to everyone at home. Pick a page in the column, then use its tabs to move between related settings. Use the **Search settings** box at the top to jump straight to a setting.

## Your pages

- **Profile and sign-in**: your name, your **Language**, your PIN or password, two-step sign-in for owners and admins, face enrollment and voice print enrollment. See [Language](language.md) and [Sign in](sign-in.md).
- **Look and ease**: the color scheme, light or dark, and ease of use. See [Ease of use](ease-of-use.md).
- **Chat and AI**: how chat works for you, search, personality, AI companions and music. The tabs are **General**, **Personalization**, **Skills**, **Keyboard shortcuts** and **Coding**.
- **Voice and robot**: your voice, the **Commands** card, the **Wake word** on this device, and your robot.
- **Notifications**: alerts and Telegram. See [Notifications](notifications.md).
- **Your data and apps**: your data, memories and signed-in devices.

## The home pages

- **Household and people**: the household's name and home place, the home's **Language and region**, and links to users and the Family page. See [People and parental controls](people.md).
- **Privacy and safety**: sensitive subjects with teen controls, and a link to what connects to the internet. See [Privacy](privacy.md).
- **AI and models**: what runs on this computer, the models for each job, engines, **Performance** and **Coding**.
- **Pictures, videos and music**: who can make them and at what level.
- **Voice**: the voices Home can speak with, and the household's commands.
- **Search and web**: web search, blocked sites and offline books. See [Set up web search](web-search.md).
- **Offline data**: the books stored on this computer. See [Offline data](reference-library.md).
- **Apps and devices**: robots, Home Assistant, Telegram and the reference library.
- **Backups, storage and updates**: limits, backups, storage, updates, repairs, performance and status.
- **Advanced**: developer tools, and network and access.
- **House**: connect Home Assistant and choose who controls what. See [Control your house from Home](house.md).
- **Clock**: your alarm choices. See [Use the Clock app](clock.md).

## Reach Home away from home

An owner or admin can open **Advanced**, then the **Network and access** tab, and choose **Set up away access**. Home guides you through installing and signing in to Tailscale, enabling its secure addresses, and opening Home on a phone or tablet. The same setup is available from the setup checklist.

Until away access is enabled, Home works only on your home network. Tailscale connects your family's devices privately. Turning on Home's secure address publishes this computer's Tailscale name in public certificate logs. Choose a plain computer name, not a family name. This setup uses Tailscale's DNS and HTTPS certificate service; Headscale is not supported.

## Clear saved online data

An owner or admin can open **Backups, storage and updates**, then **Storage**, to see saved copies Home fetched for weather, news, and other lookups. Clear one source or choose **Clear all**. This does not clear chats, memories, or items in the news shelf. Home fetches a cleared copy again the next time someone asks. If a service is taking a break, Home may wait before trying it again.

## Choose how you look

Open **Look and ease**. Pick the color scheme of the whole app. Neutral is the standard look. Navy is MaiPai's own blue-black set. The others are ready-made color sets (Stone, Zinc, Mauve, Olive, Mist, Taupe). Light and dark mode both follow the one you pick. A device choice of light, dark or system applies to this browser only and wins over your personal choice until you reset it.

## Choose your language

Open **Profile and sign-in** and find the **Language** card. Pick **English (United States)**, **English (United Kingdom)** or **Español**, or leave it on **Same as the home**. The screen changes at once. An owner or admin sets the home's language in **Household and people**, under **Language and region**. See [Language](language.md).

## Choose your voice

You can make a new voice inspired by your own recording in chat, and it will appear on the Voices page.

Open **Voice and robot**, then the **Voice** tab. Pick a voice from the **Voice for you** list and press **Test** to hear a short sentence. Press **Stop** to end it. Your choice is saved as soon as you pick it, and Home uses that voice in chat and when it reads text aloud.

If you have more than one microphone, the page also has a **Microphone** choice, remembered on this device only.

Children cannot change their own voice. An owner or admin opens the page, uses **Choose a voice for**, and picks the child. Teens and adults choose their own.

A saved voice works in a temporary chat too. Home saves nothing new when it speaks.

### Make a voice from a recording

Everyone in the home can make a voice, children and teens too. On the **Voices** page press **Make a voice from a recording**, type a name, and choose a WAV, MP3 or FLAC recording that is 6 to 30 seconds long. Home makes the voice and plays it once to check it. Then it shows up in the voice list for everyone in the home. Only use your own voice, or the voice of someone who said yes. A guest cannot make a voice.

### Make an Inspired voice

An Inspired voice is a new voice based on a recording, not a copy of it. On the **Voices** page press **Make an Inspired voice**, type a name, choose a WAV, MP3 or FLAC recording that is 6 to 30 seconds long, and choose **How different from the original**: **Different** sounds like a relative of the voice, **Very different** sounds like someone else with a similar feel. **Lower** and **Much lower** make the voice deeper instead of higher. Press **Preview** to hear about four seconds of the choice before you keep it; nothing is saved by a preview. If other voices have been made at home, you can also pick **Blend with (optional)** to mix the new voice with one of them. Home moves the recording's pitch and tone, keeps the changed recording, and shows the voice as an Inspired voice in the list and in Home settings. It follows the same rules as any voice: everyone but a guest can make one, and a parent or admin can see it, listen to it and delete it. Only use a voice that is yours or that someone said yes to. MP3 and FLAC need a converter on the computer running Home (macOS has one built in); if Home cannot open the file it asks for a WAV.

A parent or admin can see every voice made in the home, who made it, and can listen to it and delete it: open **Settings**, then **Voice**, then the **Voices** tab, and use **Test** or **Delete**. This is only about voices. A teen's other settings stay private. A child's voice for chat is still picked by a parent, so after a child makes a voice, a parent can pick it for them. An owner or admin can also set liveliness and pitch when making a voice; everyone else gets the normal sound.

If the page says "Voices are still getting ready", wait a minute. After setup the voice engine needs a short time to start. If it says "Home can't reach its voice service", open **Repairs**, then come back and press **Try again**. See [Talking to Home](voice.md) for natural speech sounds and microphone help.

## Models and storage

An owner or admin opens **Settings**, **AI and models**, then the **Advanced** tab, and finds **Models and storage**. It lists every part of the AI on this computer, such as the chat models, the voices, the picture and video models and the picture tools. Each row shows how much space it uses, when it was last used and what uses it. The top line shows how much room is left. A part Home recommends but did not install, such as Detailed videos on a Mac that was upgraded, says "Recommended, not installed" and has an **Install** button. Home never downloads it for you after an upgrade. The LTX Detailed video model is optional. It needs a Mac with 128 GB of memory and about 74 GB of disk space. Its licence is free under 10 million dollars of yearly revenue. You accepted the licences of everything Home installs once, in setup (or with the single **Accept the licences for the AI models Home installs** prompt at the top of this section on a Home set up earlier), so a part never asks for its own accept. Once the licences are accepted, an **Install the recommended extras** button appears while any recommended extra is missing. A licence that is new, or whose terms changed, asks once, in plain words.

In **Models and storage**, **Sing a song in another voice** adds voice swapping for songs. **Realistic voice for recordings** makes voiceovers and video lines sound more natural; it is not used for live chat and needs a large Mac.

Press **Install** to download a part. A bar shows how far it has got, and you can keep using Home while it downloads. If there is not enough room, or this computer is too small to run it, the button is off and the row says why. Press **Uninstall** to remove a part. Home tells you how much space it frees and that you can install it again later. Chat keeps at least one model: the model chat is using, and the only chat model, cannot be removed.

If a download stops, the row says why and offers **Try again**. The same item is also in **Repairs**.

### Assistant access

An owner or admin can let an assistant, such as Claude Code, change a few settings for them. Open **Settings**, **AI and models**, and find **Assistant access**. Press **Make an assistant key**, name it, choose the kind (change settings, or read diagnostics) and how long it lasts (7, 30 or 90 days; a diagnostics key is 7 or 30) and copy the key when Home shows it. Home shows it only once. Give the key to the assistant. It can change only the short list of settings Home allows, today how Home helps the chat remember to search the web, and nothing else: it cannot change people, passwords, safety rules or ages. It stops working on its end date, when you revoke it here, or if the person who made it is no longer an owner or admin. A diagnostics key cannot change anything. It reads how fast chat is answering and how the engines are doing, as numbers only, never what anyone said.

### Choosing which chat model answers

An owner or admin can pick the chat model. Open **Settings**, **AI and models**, then the **Advanced** tab, and look at the **Chat models** card. Each model lists what it is good at and what it costs, plus its size. The one answering now says **In use**. For another model, press **Download** and wait: the progress bar at the top shows it, and the family keeps chatting while it downloads. When it finishes, the button changes to **Use this model**. Press it and Home switches in about a minute. If the model cannot start, the card says why and the old model keeps answering. Your choice stays after a restart. To go back, press **Use this model** on the earlier one.

Qwen3.6 35B A3B is the first model offered beside the default. It starts answering almost at once, because it can skip the thinking step, and it reads the pictures you send. It is a big download (about 22 GB) and is meant for a computer with 64 GB of memory or more.

Qwen3.6 35B A3B Uncensored is a second optional model, marked with an **Uncensored** badge. It is a version of the same model with its own refusals removed, so it answers what an adult asks. It also reads pictures, and it is about a 21 GB download. Home's age and safety rules still apply in front of it, so children's chats are not changed. It is never downloaded unless you choose it. You can pick it on the **AI and models** overview (open the Chat row's gear and choose **Uncensored chat AI**, then **Apply changes**), or press **Download** in the **Advanced** tab. Picking **Standard chat AI** there puts the usual model back.

## Pictures, videos and music

An owner or admin opens **Settings**, **Pictures, videos and music**. It has these tabs.

- **Pictures.** Adults can make pictures, the level when nobody says (**Standard** or **Boost**), a **Choose models** button, and the **Children and teens** card. Children can make cartoons by default. See [cartoon controls](people.md#cartoon-pictures-and-videos).
- **Videos.** Video making on or off, the level when nobody says, a **Choose models** button and an **Open Styles** button.
- **Music.** Adults can make songs, **Song length** (**Short** or **Full**), a **Choose models** button, online radio and podcasts, and the song lookups.
- **Styles.** The one list of styles for pictures and videos: browse, add from a file, who can use each, adult-only styles behind a lock, and recently removed.

Two small parts have their own rows in **AI and models**, and the setup plan lists them too. **Telling people apart** (the face finder and matcher, 38.9 MB, MIT and Apache-2.0 licences, from huggingface.co and the OpenCV Zoo on GitHub) lets Home give each person in a picture their own panel when it builds a reference sheet; it does not name anyone. It starts ticked in setup, and its switch installs or removes the two files, which are the same two files your robots use, kept once on this computer. **Video from pictures** (the video-from-pictures adapter, 1.3 GB, the LTX-2.x Community License, from huggingface.co) is what "make a video from pictures" needs. It asks you to accept its terms on its Hugging Face page and needs your Hugging Face token (saved in **Settings**, **AI**, **Advanced**), and the household licence acceptance must cover the LTX licence. Until both are in place its row says what is missing; setup lists it and says to add it afterwards. Each row shows its size, licence, where it comes from and whether it is installed.

Choosing and installing models is done in **AI and models**. This area never shows a second control for that. See [Pictures](pictures.md), [Videos](videos.md), [Levels](levels.md) and [Songs](songs.md).

**Song length** chooses short or full songs. Short songs are about 45 seconds and take under a minute. Full songs are about 3 minutes and take a minute or two. See [Songs](songs.md).

## Web search settings

An owner or admin opens **Settings**, **Search and web**. The **Web search** block holds the SearXNG address with **Test** and **Save**, the source switches and the teen and child DuckDuckGo choice. See [Set up web search](web-search.md).

## Still need help?

If a setting won't save, or you can't find one you expect, see [Fix a problem](fix-a-problem.md).
