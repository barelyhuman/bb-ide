ALTER TABLE `threads` ADD COLUMN `environment_id` text;
--> statement-breakpoint
CREATE INDEX `threads_environment_idx` ON `threads` (`environment_id`);
--> statement-breakpoint
UPDATE `threads`
SET `environment_id` = 'local'
WHERE `environment_id` IS NULL;
