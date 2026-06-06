DROP INDEX `events_producer_event_id_idx`;--> statement-breakpoint
ALTER TABLE `events` DROP COLUMN `producer_event_id`;--> statement-breakpoint
ALTER TABLE `events` DROP COLUMN `producer_event_payload_hash`;
