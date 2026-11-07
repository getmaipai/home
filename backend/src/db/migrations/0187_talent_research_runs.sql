CREATE TABLE `talent_research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`synth_id` text NOT NULL,
	`ran_at` text NOT NULL,
	`day_key` text NOT NULL,
	`facts` integer NOT NULL,
	`views` integer NOT NULL,
	`style` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `talent_research_runs_day` ON `talent_research_runs` (`day_key`);