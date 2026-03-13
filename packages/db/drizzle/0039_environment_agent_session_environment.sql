ALTER TABLE `environment_agent_sessions`
ADD COLUMN `environment_id` text REFERENCES `environments`(`id`) ON DELETE cascade;

CREATE INDEX `environment_agent_sessions_environment_status_idx`
ON `environment_agent_sessions` (`environment_id`,`status`);
