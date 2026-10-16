# How MaiPai Home works (/docs/admin/how-it-works/how-home-works)

MaiPai Home is one program that runs on a computer in your house. People reach it from a browser on a phone, tablet or laptop on your home Wi-Fi. Nothing goes through a MaiPai server, because there is none.

## 🗺️ The parts [#️-the-parts]

```
 Phone, tablet, laptop (browser)
            |
            |  your home network
            v
 +-------------------------------+        +---------------------------+
 | MaiPai Home (the hub)         |        | MaiPai Stack (the engine) |
 | people, memory, chat, settings| -----> | runs the AI models        |
 | packages, backups, updates    |        | same computer, or another |
 | stores: the data folder       |        | stores: models, engines   |
 +-------------------------------+        +---------------------------+
            |
            |  only what you allow
            v
   The internet (see Privacy audit)
```

| Part | What it does | Where it runs |
|---|---|---|
| **Home (the hub)** | Holds people, memories, conversations, settings, backups and the screens everyone uses. | The computer you installed it on. |
| **Stack (the engine)** | Runs the AI models for chat, listening, speaking and pictures. | The same computer, or a second one. See [Use another computer for the AI](/docs/admin/install-and-set-up/use-another-computer-for-the-ai). |
| **Packages** | Small features such as weather, timers and news. Home ships a default set. | Inside Home. |
| **Robot** | An optional companion body that pairs with Home. | Its own hardware. |

## 🔁 What happens when someone asks a question [#-what-happens-when-someone-asks-a-question]

1. The person types or speaks in the browser.
2. Home checks who they are and what their role allows.
3. Home builds the request and sends it to the engine.
4. The engine answers. Home checks the reply against the person's age band before showing it.
5. Home stores the conversation in its own folder.

If the engine is unreachable, chat pauses and Repairs shows why. Nothing is sent elsewhere as a fallback.

## 🏠 What this means for you [#-what-this-means-for-you]

- Your household's data stays in one folder you can back up. See [Where your data lives](/docs/admin/how-it-works/where-your-data-lives).
- Safety is built into Home, not into a package. Child protections cannot be removed. See [Safety settings](/docs/admin/people-and-safety/safety-settings).
- Home does not phone home. Every outbound connection is listed on the Privacy page. See [Privacy audit](/docs/admin/look-after-it/privacy-audit).

## 🧭 Where things are in the app [#-where-things-are-in-the-app]

The main menu has **Home**, **Chat**, **Family**, **Privacy** and **Settings**. Admin work lives under **Settings**, in the **Home settings** area. Backups, Updates, Repairs, Status, Storage and Engines are pages you reach from Settings.

<Callout type="info">The sidebar in some screenshots still says People. That page is now called Family.</Callout>
