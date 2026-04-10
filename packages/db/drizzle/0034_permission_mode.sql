ALTER TABLE `project_execution_defaults` RENAME COLUMN `sandbox_mode` TO `permission_mode`;
--> statement-breakpoint
UPDATE `project_execution_defaults`
SET `permission_mode` = CASE `permission_mode`
  WHEN 'danger-full-access' THEN 'full'
  ELSE 'limited'
END;
--> statement-breakpoint
ALTER TABLE `queued_thread_messages` RENAME COLUMN `sandbox_mode` TO `permission_mode`;
--> statement-breakpoint
UPDATE `queued_thread_messages`
SET `permission_mode` = CASE `permission_mode`
  WHEN 'danger-full-access' THEN 'full'
  ELSE 'limited'
END;
