CREATE TABLE `__new_queued_thread_messages` (
  `id` text PRIMARY KEY NOT NULL,
  `thread_id` text NOT NULL,
  `content` text NOT NULL,
  `model` text NOT NULL,
  `reasoning_level` text NOT NULL,
  `sandbox_mode` text NOT NULL,
  `service_tier` text NOT NULL,
  `claimed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_queued_thread_messages` (
  `id`,
  `thread_id`,
  `content`,
  `model`,
  `reasoning_level`,
  `sandbox_mode`,
  `service_tier`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `thread_id`,
  `content`,
  `model`,
  `reasoning_level`,
  `sandbox_mode`,
  `service_tier`,
  `created_at`,
  `updated_at`
FROM `queued_thread_messages`;
--> statement-breakpoint
DROP TABLE `queued_thread_messages`;
--> statement-breakpoint
ALTER TABLE `__new_queued_thread_messages` RENAME TO `queued_thread_messages`;
--> statement-breakpoint
CREATE INDEX `queued_thread_messages_thread_created_idx` ON `queued_thread_messages` (`thread_id`,`created_at`,`id`);
