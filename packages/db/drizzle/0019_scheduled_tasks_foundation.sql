CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_config` text NOT NULL,
	`action` text NOT NULL,
	`auto_archive` integer DEFAULT false NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`run_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automations_project_idx` ON `automations` (`project_id`);
--> statement-breakpoint
CREATE INDEX `automations_due_idx` ON `automations` (`enabled`,`trigger_type`,`next_run_at`);
--> statement-breakpoint
ALTER TABLE `threads` ADD `automation_id` text REFERENCES automations(id) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `threads_automation_runtime_idx` ON `threads` (`automation_id`,`archived_at`,`deleted_at`,`status`);
--> statement-breakpoint
CREATE TABLE `manager_thread_nudges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`name` text NOT NULL,
	`cron` text NOT NULL,
	`timezone` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_fire_at` integer NOT NULL,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `manager_thread_nudges_due_idx` ON `manager_thread_nudges` (`enabled`,`next_fire_at`);
--> statement-breakpoint
CREATE INDEX `manager_thread_nudges_project_idx` ON `manager_thread_nudges` (`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `manager_thread_nudges_sync_key_idx` ON `manager_thread_nudges` (`project_id`,`thread_id`,`name`);
