ALTER TABLE `projects` ADD `primary_checkout_thread_id` text;
--> statement-breakpoint
CREATE INDEX `projects_primary_checkout_thread_idx` ON `projects` (`primary_checkout_thread_id`);
--> statement-breakpoint
CREATE INDEX `threads_archived_status_idx` ON `threads` (`archived_at`, `status`);
