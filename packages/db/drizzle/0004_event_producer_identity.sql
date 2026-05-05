ALTER TABLE `events` ADD `producer_event_id` text;
--> statement-breakpoint
ALTER TABLE `events` ADD `producer_event_payload_hash` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `events_producer_event_id_idx` ON `events` (`producer_event_id`);
