ALTER TABLE `thread_operations` ADD `provisioning_id` text;
--> statement-breakpoint
ALTER TABLE `thread_operations` ADD `provisioning_stage` text;
--> statement-breakpoint
ALTER TABLE `thread_operations` ADD `provisioning_environment_id` text REFERENCES `environments`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `thread_operations` ADD `provision_event_sequence` integer;
--> statement-breakpoint
ALTER TABLE `thread_operations` ADD `workspace_ready_event_sequence` integer;
--> statement-breakpoint
UPDATE `thread_operations`
SET
  `provisioning_id` = json_extract(`payload`, '$.provisioningId'),
  `provisioning_stage` = json_extract(`payload`, '$.stage'),
  `provisioning_environment_id` = json_extract(`payload`, '$.attachedEnvironmentId'),
  `provision_event_sequence` = json_extract(`payload`, '$.provisionEventSequence'),
  `workspace_ready_event_sequence` = json_extract(`payload`, '$.workspaceReadyEventSequence')
WHERE
  `kind` = 'provision'
  AND json_valid(`payload`)
  AND json_extract(`payload`, '$.provisioningId') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `thread_operations_provisioning_idx` ON `thread_operations` (`provisioning_id`);
--> statement-breakpoint
CREATE INDEX `thread_operations_provisioning_environment_idx` ON `thread_operations` (`provisioning_environment_id`);
