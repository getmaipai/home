# Where your data lives (/docs/admin/how-it-works/where-your-data-lives)

{/* generated-source: backend/src/lib/dataClasses.ts, backend/src/lib/paths.ts, backend/src/lib/backup.ts, scripts/uninstall.sh */}

Home keeps everything in one **data folder**. The default is a folder named `data` at the top of the Home folder. Two backup folders sit beside it, not inside it.

## 📁 What is in each folder [#-what-is-in-each-folder]

| Folder | What it holds | Replaceable? |
|---|---|---|
| `records` (the data folder itself) | People, memories, conversations, settings in one database file | No. Back this up. |
| `keys` | Encryption keys for secrets and face prints | No. Keep on a disk that is always connected. |
| `people` | Each person's files | No |
| `voice/cloned` | Cloned voices | No |
| `projects` | Project files | No |
| `packages` | Package data | Mostly |
| `models`, `engines`, `sidecars` | Downloaded AI models, engines and helper programs | Yes, downloaded again |
| `reference` | The offline reference library | Yes, downloaded again |
| `lists` | Blocked-site lists | Yes |
| `voice/stt`, `voice/wakewords`, `vision/models` | Speech, wake-word and face recognition models | Yes |
| `logs`, `cache`, `favicons`, `answer-images`, `local-app`, `labels` | Logs, caches and runtime files | Yes |
| `backups` (beside the data folder) | Your encrypted backup files | See below |
| `received-backups` (beside the data folder) | Backups pushed by paired devices | Not yet used by the app UI |

Put `records` and `backups` on different disks. A backup on the same disk is no safer than the data it copies.

## 💾 What a backup covers [#-what-a-backup-covers]

Today a backup is an encrypted copy of the household database: people, memories, conversations and settings. It does not include models, engines, the reference library or people's uploaded files. Those are downloaded or copied again after a restore. See [Backups and restore](/docs/admin/look-after-it/backups-and-restore).

## 🧹 Move or remove [#-move-or-remove]

- The Storage page shows what each person uses and the caps.
- To change where a folder lives, there is no screen yet. Planned, not in the app yet: the data-location picker. The setup wizard says so too.
- To uninstall, run the uninstall script. It asks before it deletes anything, and every prompt defaults to keep. See [Install and start](/docs/admin/install-and-set-up/install-and-start).

## ⚠️ Before you delete a folder you do not recognise [#️-before-you-delete-a-folder-you-do-not-recognise]

A folder that looks stray may be live household data. Open it first and check what it holds. Never delete `records` or `keys` without a backup and the backup key.
