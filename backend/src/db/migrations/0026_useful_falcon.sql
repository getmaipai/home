ALTER TABLE `app_update_state` ADD `assets_json` text;--> statement-breakpoint
ALTER TABLE `notification_deliveries` ADD `subject_person_id` text REFERENCES people(id);