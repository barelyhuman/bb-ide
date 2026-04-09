CREATE TABLE `sandbox_provider_credentials` (
  `id` text PRIMARY KEY NOT NULL,
  `provider_id` text NOT NULL,
  `encrypted_payload` text NOT NULL,
  `label` text,
  `expires_at` integer,
  `last_refreshed_at` integer,
  `last_error_message` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_provider_credentials_provider_id_idx`
ON `sandbox_provider_credentials` (`provider_id`);
--> statement-breakpoint
CREATE INDEX `sandbox_provider_credentials_expires_at_idx`
ON `sandbox_provider_credentials` (`expires_at`);
