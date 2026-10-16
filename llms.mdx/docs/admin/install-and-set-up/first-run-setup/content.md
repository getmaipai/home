# First-run setup (/docs/admin/install-and-set-up/first-run-setup)

The first time you open Home it starts a setup wizard. It has three phases: **Your computers**, **Away from home** and **Meet your Home**.

<Callout type="info" title="Pre-alpha">
Some wizard screens say plainly that a step is not built yet. Those are listed below so you know what to expect.
</Callout>

<Shot id="setup-wizard" />

## 🪜 The screens [#-the-screens]

| Screen | What it does | State |
|---|---|---|
| Welcome | Press **Set up my Home**. | Built |
| **Where should Home's AI run?** | Pick **This computer** or **Another computer**. | Built |
| Storage | Choose where the AI models are stored. | Not built. The wizard says a disk picker is not available. |
| Setup checks | Test the computer. | Not built. It says so. |
| Plan | Recommend models for your hardware. | Not built. The plan from the installer is recorded for later. |
| **Reach Home from anywhere** | Set up Tailscale. | Not built here. Press **Set up later**, then finish in Settings. |
| **Create your owner account** | Your name and a PIN or password. | Built |
| **Let Home recognise you** | Face enrollment. | Optional. **Do this later** works. |
| First greeting | Home says hello. | Not built |
| **Your Home is ready** | Save your backup key, then **Open my Home**. | Built |

## 👑 Create the owner [#-create-the-owner]

1. Type your name.
2. Type a PIN or password. The owner and admin roles need one. The screen has an **Owner or admin?** note explaining the difference.
3. Continue.

The owner can add everyone else, including admins. See [People, roles and permissions](/docs/admin/how-it-works/people-roles-and-permissions).

If Home was already set up, it says "Home is already set up. Sign in instead." If it cannot read its progress, it says "Home can't read its setup progress. Refresh this page. If it keeps happening, restart MaiPai Home on this computer or run the installer again."

## 🔑 Save the backup key [#-save-the-backup-key]

On the last screen, press **Download** or **Print** under **Save your backup key**. Keep it somewhere other than this computer. If this computer breaks, the key brings your backups back on a new one. See [Backups and restore](/docs/admin/look-after-it/backups-and-restore).

Then press **Open my Home**.

## 📝 After setup [#-after-setup]

The wizard says how many things are left. They are in the setup checklist on the Home screen, such as adding family, enabling away access and saving the backup key. Come back to them at your own pace.

1. Add your family: [Add people](/docs/admin/people-and-safety/add-people-and-parental-controls).
2. Connect search: [Set up web search](/docs/admin/connect-and-extend/web-search).
3. Check what leaves the house: [Privacy audit](/docs/admin/look-after-it/privacy-audit).

For what the wizard looks like to a first-time user, see [Your first minutes](/docs/user/start-here/your-first-minutes).
