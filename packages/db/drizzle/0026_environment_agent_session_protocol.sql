CREATE TABLE `environment_agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`agent_instance_id` text NOT NULL,
	`protocol_version` integer NOT NULL,
	`transport_kind` text NOT NULL,
	`status` text NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`last_heartbeat_at` integer,
	`closed_at` integer,
	`close_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `environment_agent_sessions_thread_status_idx` ON `environment_agent_sessions` (`thread_id`,`status`);
--> statement-breakpoint
CREATE INDEX `environment_agent_sessions_agent_status_idx` ON `environment_agent_sessions` (`agent_id`,`status`);
--> statement-breakpoint
CREATE INDEX `environment_agent_sessions_lease_expires_idx` ON `environment_agent_sessions` (`lease_expires_at`);
--> statement-breakpoint
CREATE TABLE `environment_agent_cursors` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`generation` integer NOT NULL,
	`sequence` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `environment_agent_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`session_id` text,
	`command_cursor` integer NOT NULL,
	`command_type` text NOT NULL,
	`payload` text NOT NULL,
	`state` text NOT NULL,
	`result` text,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `environment_agent_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environment_agent_commands_thread_cursor_idx` ON `environment_agent_commands` (`thread_id`,`command_cursor`);
--> statement-breakpoint
CREATE INDEX `environment_agent_commands_thread_state_updated_idx` ON `environment_agent_commands` (`thread_id`,`state`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `environment_agent_commands_session_state_idx` ON `environment_agent_commands` (`session_id`,`state`);
