ALTER TABLE `events` ADD `item_id` text;
--> statement-breakpoint
ALTER TABLE `events` ADD `item_kind` text;
--> statement-breakpoint
CREATE INDEX `events_thread_type_item_kind_sequence_idx` ON `events` (`thread_id`,`type`,`item_kind`,`sequence`);
--> statement-breakpoint
CREATE INDEX `events_thread_item_id_sequence_idx` ON `events` (`thread_id`,`item_id`,`sequence`);
