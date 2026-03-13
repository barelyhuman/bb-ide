ALTER TABLE `projects` ADD COLUMN `primary_manager_thread_id` text;
--> statement-breakpoint
CREATE INDEX `projects_primary_manager_thread_idx` ON `projects` (`primary_manager_thread_id`);
--> statement-breakpoint
ALTER TABLE `threads` ADD COLUMN `type` text NOT NULL DEFAULT 'standard';
