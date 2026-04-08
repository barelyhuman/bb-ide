ALTER TABLE `hosts` ADD `last_activity_at` integer;
--> statement-breakpoint
ALTER TABLE `hosts` ADD `suspended_at` integer;
--> statement-breakpoint
CREATE INDEX `hosts_last_activity_idx` ON `hosts` (`last_activity_at`);
--> statement-breakpoint
CREATE INDEX `hosts_suspended_idx` ON `hosts` (`suspended_at`);
--> statement-breakpoint
CREATE TABLE `host_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`payload` text NOT NULL,
	`command_id` text,
	`requested_at` integer NOT NULL,
	`queued_at` integer,
	`completed_at` integer,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`command_id`) REFERENCES `host_daemon_commands`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `host_operations_host_kind_idx` ON `host_operations` (`host_id`,`kind`);
--> statement-breakpoint
CREATE UNIQUE INDEX `host_operations_command_idx` ON `host_operations` (`command_id`);
--> statement-breakpoint
CREATE INDEX `host_operations_state_idx` ON `host_operations` (`state`);
--> statement-breakpoint
CREATE INDEX `host_operations_host_idx` ON `host_operations` (`host_id`);
