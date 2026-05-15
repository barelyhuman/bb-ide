CREATE TABLE `prompt_history_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `thread_id` text NOT NULL,
  `scope` text NOT NULL,
  `request_sequence` integer NOT NULL,
  `input` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_history_entries_thread_request_idx` ON `prompt_history_entries` (`thread_id`,`request_sequence`);
--> statement-breakpoint
CREATE INDEX `prompt_history_entries_project_scope_created_idx` ON `prompt_history_entries` (`project_id`,`scope`,`created_at`,`request_sequence`,`id`);
--> statement-breakpoint
CREATE INDEX `prompt_history_entries_thread_scope_created_idx` ON `prompt_history_entries` (`thread_id`,`scope`,`created_at`,`request_sequence`,`id`);
