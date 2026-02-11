PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`project_id` text NOT NULL,
	`title` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_threads`(`id`, `task_id`, `project_id`, `title`, `status`, `created_at`, `updated_at`)
SELECT `id`, `task_id`, `project_id`, NULL, `status`, `created_at`, `updated_at` FROM `threads`;
--> statement-breakpoint
DROP TABLE `threads`;
--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;
--> statement-breakpoint
CREATE INDEX `threads_task_idx` ON `threads` (`task_id`);
--> statement-breakpoint
CREATE INDEX `threads_project_updated_idx` ON `threads` (`project_id`,`updated_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
