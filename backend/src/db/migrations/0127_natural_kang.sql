DELETE FROM settings_values WHERE key IN ('likeness.adults', 'likeness.adult_content');--> statement-breakpoint
UPDATE likeness_adapters SET state = 'removed' WHERE state = 'removal_queued';--> statement-breakpoint
DROP TABLE `likeness_consent_events`;--> statement-breakpoint
DROP TABLE `likeness_uses`;