ALTER TABLE `memory_records` ADD `created_by` text REFERENCES `people`(`id`) ON DELETE SET NULL;
