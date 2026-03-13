ALTER TABLE `projects` ADD COLUMN `primary_manager_thread_id` text;
CREATE INDEX `projects_primary_manager_thread_idx` ON `projects` (`primary_manager_thread_id`);
ALTER TABLE `threads` ADD COLUMN `type` text NOT NULL DEFAULT 'standard';
