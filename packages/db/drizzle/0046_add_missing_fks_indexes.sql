-- Q19: Unique index on environments(project_id, descriptor)
CREATE UNIQUE INDEX `environments_project_descriptor_idx` ON `environments` (`project_id`, `descriptor`);

--> statement-breakpoint
-- Q21: Composite index on environment_agent_sessions(status, lease_expires_at)
CREATE INDEX `environment_agent_sessions_status_lease_idx` ON `environment_agent_sessions` (`status`, `lease_expires_at`);

--> statement-breakpoint
-- Q20: Rebuild threads table to add FK constraints on environmentId and parentThreadId
CREATE TABLE `__new_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
	`provider_id` text NOT NULL DEFAULT 'codex',
	`type` text NOT NULL DEFAULT 'standard',
	`title` text,
	`status` text NOT NULL DEFAULT 'created',
	`environment_id` text,
	`merge_base_branch` text,
	`parent_thread_id` text REFERENCES `threads`(`id`) ON DELETE SET NULL,
	`archived_at` integer,
	`last_read_at` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_threads` SELECT * FROM `threads`;
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
-- Q20: Rebuild projects table to add FK constraints on primaryCheckoutThreadId and primaryManagerThreadId
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`project_instructions` text,
	`primary_checkout_thread_id` text REFERENCES `threads`(`id`) ON DELETE SET NULL,
	`primary_manager_thread_id` text REFERENCES `threads`(`id`) ON DELETE SET NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_projects` SELECT * FROM `projects`;
--> statement-breakpoint
DROP TABLE `projects`;
--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;
--> statement-breakpoint
CREATE INDEX `projects_primary_checkout_thread_idx` ON `projects` (`primary_checkout_thread_id`);
--> statement-breakpoint
CREATE INDEX `projects_primary_manager_thread_idx` ON `projects` (`primary_manager_thread_id`);
