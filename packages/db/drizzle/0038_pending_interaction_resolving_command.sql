ALTER TABLE `pending_interactions` ADD `resolving_command_id` text REFERENCES host_daemon_commands(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `pending_interactions_resolving_command_idx` ON `pending_interactions` (`resolving_command_id`);--> statement-breakpoint
UPDATE `pending_interactions`
SET `resolving_command_id` = (
  SELECT `host_daemon_commands`.`id`
  FROM `host_daemon_commands`
  WHERE `host_daemon_commands`.`type` = 'interactive.resolve'
    AND json_extract(`host_daemon_commands`.`payload`, '$.interactionId') = `pending_interactions`.`id`
  ORDER BY `host_daemon_commands`.`created_at` DESC
  LIMIT 1
)
WHERE `pending_interactions`.`status` = 'resolving'
  AND `pending_interactions`.`resolving_command_id` IS NULL;
