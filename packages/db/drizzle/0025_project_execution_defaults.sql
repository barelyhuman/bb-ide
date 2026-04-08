CREATE TABLE `project_execution_defaults` (
	`project_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model` text NOT NULL,
	`service_tier` text NOT NULL,
	`reasoning_level` text NOT NULL,
	`sandbox_mode` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_execution_defaults_project_provider_idx` ON `project_execution_defaults` (`project_id`,`provider_id`);--> statement-breakpoint
CREATE INDEX `project_execution_defaults_project_idx` ON `project_execution_defaults` (`project_id`);