DELETE FROM settings_values WHERE scope = 'household' AND key = '_licences.accepted';--> statement-breakpoint
DELETE FROM issues WHERE source = 'install' AND key = 'licences.accept';
