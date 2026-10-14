ALTER TABLE `sessions` ADD `sign_in_source` text DEFAULT 'local' NOT NULL;
UPDATE `sessions` SET `sign_in_source` = 'paired_device' WHERE `device_id` IS NOT NULL;
