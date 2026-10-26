-- LIKENESS-SIMPLIFY-01: stored per-person values never grant permission after upgrade or restore.
DELETE FROM `settings_values` WHERE `key` IN ('likeness.adults', 'likeness.adult_content');
--> statement-breakpoint
DROP TABLE IF EXISTS `likeness_consent_events`;
--> statement-breakpoint
DROP TABLE IF EXISTS `likeness_uses`;
