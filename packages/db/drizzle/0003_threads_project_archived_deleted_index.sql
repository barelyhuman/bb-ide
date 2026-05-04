CREATE INDEX `threads_project_archived_deleted_idx` ON `threads` (`project_id`,`archived_at`,`deleted_at`,`id`);
