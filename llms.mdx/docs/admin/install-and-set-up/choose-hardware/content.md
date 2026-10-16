# Choose hardware (/docs/admin/install-and-set-up/choose-hardware)

<Callout type="info" title="Pre-alpha">
Home does not publish minimum specs yet. This page gives what the code supports and the tool that tells you whether a model fits your computer. It lists no speed numbers.
</Callout>

## 🖥️ What the installer supports [#️-what-the-installer-supports]

| Item | Supported |
|---|---|
| Operating system | macOS and Linux. Windows has a separate installer script. |
| Chip | x64 and arm64 |
| Engine computer (a second machine for the AI) | Ubuntu Linux only |

Home itself is light. The AI models are the heavy part. They need memory (RAM, or video memory on a graphics card) and disk space. The AI models page says the models it lists are about 7 to 10 GB each.

## ✅ Check a model against your computer [#-check-a-model-against-your-computer]

The **fit check** answers "will this model run here" before you download anything.

<Shot id="fit-check" />

1. Open **Settings**, **Home settings**, **Engines and AI**, then **AI models**.
2. Each model shows a verdict:

| Verdict | Meaning |
|---|---|
| **Runs well on this computer** | The model fits in memory with room to spare. |
| **Runs, but slowly** | It fits, but expect long waits. |
| **Won't fit** | It needs more memory than the computer has. |
| **Can't tell yet** | Home cannot read the computer's memory or the model's size. |

3. To check a model that is not listed, paste a Hugging Face link in **Check a model**.

The fit check needs the Stack (the engine software) to be running. A memory meter shows what is free.

## 🧭 Pick a shape [#-pick-a-shape]

| Setup | Good when |
|---|---|
| One computer runs Home and the AI | You have a Mac or PC with enough memory for a model you like. |
| Home on a small computer, AI on a stronger one | The stronger machine is Ubuntu. See [Use another computer for the AI](/docs/admin/install-and-set-up/use-another-computer-for-the-ai). |

## 💽 Disk and backups [#-disk-and-backups]

Keep the data folder on a disk with room for models and engines, and put backups on a different disk. Home raises a Repairs item when free space on its own disk drops below 2 GB (a setting you can change). Per-person storage has no cap by default. See [Where your data lives](/docs/admin/how-it-works/where-your-data-lives).

## 📋 Not declared yet [#-not-declared-yet]

- Minimum RAM, disk and graphics card.
- A list of tested computers.
- Speed numbers for any model.

Until those exist, treat the fit check as the answer, and start with a smaller model.
