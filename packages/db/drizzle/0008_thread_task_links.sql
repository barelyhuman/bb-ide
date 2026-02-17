ALTER TABLE `threads` ADD COLUMN `task_id` text;
--> statement-breakpoint
ALTER TABLE `threads` ADD COLUMN `task_role` text;
--> statement-breakpoint
ALTER TABLE `threads` ADD COLUMN `parent_thread_id` text;
--> statement-breakpoint

UPDATE `threads`
SET
  `task_id` = (
    SELECT te.task_id
    FROM task_events te
    WHERE te.type = 'task.chat.thread_bound'
      AND json_extract(te.data, '$.threadId') = threads.id
    ORDER BY te.seq DESC
    LIMIT 1
  ),
  `task_role` = COALESCE(
    (
      SELECT json_extract(te.data, '$.threadRole')
      FROM task_events te
      WHERE te.type = 'task.chat.thread_bound'
        AND json_extract(te.data, '$.threadId') = threads.id
      ORDER BY te.seq DESC
      LIMIT 1
    ),
    'worker'
  ),
  `parent_thread_id` = (
    SELECT json_extract(te.data, '$.parentThreadId')
    FROM task_events te
    WHERE te.type = 'task.chat.thread_bound'
      AND json_extract(te.data, '$.threadId') = threads.id
    ORDER BY te.seq DESC
    LIMIT 1
  )
WHERE EXISTS (
  SELECT 1
  FROM task_events te
  WHERE te.type = 'task.chat.thread_bound'
    AND json_extract(te.data, '$.threadId') = threads.id
);
--> statement-breakpoint

CREATE INDEX `threads_task_role_updated_idx`
  ON `threads` (`task_id`, `task_role`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `threads_parent_thread_idx`
  ON `threads` (`parent_thread_id`);
