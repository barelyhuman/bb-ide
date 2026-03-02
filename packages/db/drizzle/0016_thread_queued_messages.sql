CREATE TABLE `queued_thread_messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`thread_id` text NOT NULL,
	`input` text DEFAULT '[]' NOT NULL,
	`model` text,
	`reasoning_level` text NOT NULL,
	`sandbox_mode` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queued_thread_messages_id_unique` ON `queued_thread_messages` (`id`);
--> statement-breakpoint
CREATE INDEX `queued_thread_messages_thread_seq_idx` ON `queued_thread_messages` (`thread_id`,`seq`);
--> statement-breakpoint
CREATE INDEX `queued_thread_messages_thread_created_idx` ON `queued_thread_messages` (`thread_id`,`created_at`);
