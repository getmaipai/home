CREATE TABLE IF NOT EXISTS `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`name` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`status` text NOT NULL,
	`last_used_at` text,
	`last_used_from` text,
	`limits` text NOT NULL,
	`hint` text NOT NULL,
	`secret_hash` text,
	`legacy_hash` text,
	`legacy_format` integer DEFAULT false NOT NULL,
	`compatibility` integer DEFAULT false NOT NULL,
	`provenance` text NOT NULL,
	`hlc` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `api_keys_secret_hash_unique` ON `api_keys` (`secret_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `api_keys_legacy_hash_unique` ON `api_keys` (`legacy_hash`);
--> statement-breakpoint
-- CODE-KEYS-01: each live person_api_tokens row becomes a turn key. The old unpeppered hash stays in legacy_hash only until
-- the key is next used (it is then re-hashed under the pepper and cleared) or until the key expires 90 days from now.
-- The old table stays in place and is never read again; a later migration drops it. Already expired tokens are not carried.
INSERT INTO `api_keys` (`id`, `person_id`, `name`, `scopes`, `created_at`, `expires_at`, `revoked_at`, `status`, `last_used_at`, `last_used_from`, `limits`, `hint`, `secret_hash`, `legacy_hash`, `legacy_format`, `compatibility`, `provenance`, `hlc`, `updated_at`)
SELECT 'key_' || lower(hex(randomblob(12))), t.`person_id`, 'Voice and Home Assistant', '["turn"]', t.`created_at`,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days'), NULL, 'active', t.`last_used_at`, NULL, '{"requests_per_minute":60}', '----', NULL,
  t.`token_hash`, 1, 1, 'Carried over from the earlier voice and Home Assistant token',
  (CAST(strftime('%s', 'now') AS INTEGER) * 1000) || ':0:migrate', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `person_api_tokens` t
WHERE t.`expires_at` > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  AND EXISTS (SELECT 1 FROM `people` p WHERE p.`id` = t.`person_id`)
  AND NOT EXISTS (SELECT 1 FROM `api_keys` k WHERE k.`person_id` = t.`person_id` AND k.`compatibility` = 1);
