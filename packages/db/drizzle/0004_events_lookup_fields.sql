ALTER TABLE `events` ADD COLUMN `norm_type` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `turn_id` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `provider_thread_id` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `is_turn_lifecycle` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `is_thread_identity` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `events`
SET
  `norm_type` = lower(replace(`type`, '.', '/')),
  `turn_id` = coalesce(
    json_extract(`data`, '$.turnId'),
    json_extract(`data`, '$.turn_id'),
    json_extract(`data`, '$.turn.id'),
    json_extract(`data`, '$.msg.turn_id'),
    json_extract(`data`, '$.msg.turnId'),
    json_extract(`data`, '$.payload.turnId'),
    json_extract(`data`, '$.payload.turn_id'),
    json_extract(`data`, '$.payload.turn.id'),
    json_extract(`data`, '$.payload.msg.turn_id'),
    json_extract(`data`, '$.payload.msg.turnId')
  ),
  `provider_thread_id` = coalesce(
    json_extract(`data`, '$.threadId'),
    json_extract(`data`, '$.thread_id'),
    json_extract(`data`, '$.thread.id'),
    json_extract(`data`, '$.conversationId'),
    json_extract(`data`, '$.conversation_id'),
    json_extract(`data`, '$.msg.thread_id'),
    json_extract(`data`, '$.msg.threadId'),
    json_extract(`data`, '$.payload.threadId'),
    json_extract(`data`, '$.payload.thread_id'),
    json_extract(`data`, '$.payload.thread.id'),
    json_extract(`data`, '$.payload.conversationId'),
    json_extract(`data`, '$.payload.conversation_id'),
    json_extract(`data`, '$.payload.msg.thread_id'),
    json_extract(`data`, '$.payload.msg.threadId')
  ),
  `is_turn_lifecycle` = CASE
    WHEN lower(replace(`type`, '.', '/')) IN ('turn/start', 'turn/started', 'turn/end', 'turn/completed')
      THEN 1
    ELSE 0
  END,
  `is_thread_identity` = CASE
    WHEN coalesce(
      json_extract(`data`, '$.threadId'),
      json_extract(`data`, '$.thread_id'),
      json_extract(`data`, '$.thread.id'),
      json_extract(`data`, '$.conversationId'),
      json_extract(`data`, '$.conversation_id'),
      json_extract(`data`, '$.msg.thread_id'),
      json_extract(`data`, '$.msg.threadId'),
      json_extract(`data`, '$.payload.threadId'),
      json_extract(`data`, '$.payload.thread_id'),
      json_extract(`data`, '$.payload.thread.id'),
      json_extract(`data`, '$.payload.conversationId'),
      json_extract(`data`, '$.payload.conversation_id'),
      json_extract(`data`, '$.payload.msg.thread_id'),
      json_extract(`data`, '$.payload.msg.threadId')
    ) IS NOT NULL
      THEN 1
    ELSE 0
  END;
--> statement-breakpoint
CREATE INDEX `events_thread_lifecycle_seq_idx`
  ON `events` (`thread_id`, `seq` DESC)
  WHERE `is_turn_lifecycle` = 1;
--> statement-breakpoint
CREATE INDEX `events_thread_identity_seq_idx`
  ON `events` (`thread_id`, `seq` DESC)
  WHERE `is_thread_identity` = 1;
