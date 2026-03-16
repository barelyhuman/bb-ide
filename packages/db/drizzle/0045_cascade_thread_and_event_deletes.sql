-- Add ON DELETE CASCADE to threads.project_id and events.thread_id.
-- Requires table rebuild since SQLite does not support ALTER COLUMN.

-- Rebuild threads table with cascade on project_id FK.
CREATE TABLE `__new_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
	`provider_id` text NOT NULL DEFAULT 'codex',
	`type` text NOT NULL DEFAULT 'standard',
	`title` text,
	`status` text NOT NULL DEFAULT 'created',
	`environment_id` text,
	`merge_base_branch` text,
	`parent_thread_id` text,
	`archived_at` integer,
	`last_read_at` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_threads` (`id`, `project_id`, `provider_id`, `type`, `title`, `status`, `environment_id`, `merge_base_branch`, `parent_thread_id`, `archived_at`, `last_read_at`, `created_at`, `updated_at`) SELECT `id`, `project_id`, `provider_id`, `type`, `title`, `status`, `environment_id`, `merge_base_branch`, `parent_thread_id`, `archived_at`, `last_read_at`, `created_at`, `updated_at` FROM `threads`;
--> statement-breakpoint
DROP TABLE `threads`;
--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;
--> statement-breakpoint
CREATE INDEX `threads_project_updated_idx` ON `threads` (`project_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `threads_environment_idx` ON `threads` (`environment_id`);
--> statement-breakpoint
CREATE INDEX `threads_parent_thread_idx` ON `threads` (`parent_thread_id`);
--> statement-breakpoint
CREATE INDEX `threads_archived_status_idx` ON `threads` (`archived_at`,`status`);
--> statement-breakpoint
CREATE INDEX `threads_archived_environment_idx` ON `threads` (`archived_at`,`environment_id`);

--> statement-breakpoint
-- Rebuild events table with cascade on thread_id FK.
CREATE TABLE `__new_events` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL REFERENCES `threads`(`id`) ON DELETE CASCADE,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`norm_type` text NOT NULL DEFAULT '',
	`turn_id` text,
	`provider_thread_id` text,
	`is_turn_lifecycle` integer NOT NULL DEFAULT false,
	`is_thread_identity` integer NOT NULL DEFAULT false,
	`data` text NOT NULL DEFAULT '{}',
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_events` (`id`, `thread_id`, `seq`, `type`, `norm_type`, `turn_id`, `provider_thread_id`, `is_turn_lifecycle`, `is_thread_identity`, `data`, `created_at`) SELECT `id`, `thread_id`, `seq`, `type`, `norm_type`, `turn_id`, `provider_thread_id`, `is_turn_lifecycle`, `is_thread_identity`, `data`, `created_at` FROM `events`;
--> statement-breakpoint
DROP TABLE `events`;
--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;
--> statement-breakpoint
CREATE INDEX `events_thread_seq_idx` ON `events` (`thread_id`,`seq`);
