UPDATE `environments`
SET `cleanup_mode` = 'safe'
WHERE `cleanup_mode` IS NOT NULL;
--> statement-breakpoint
UPDATE `environment_operations`
SET `payload` = '{}'
WHERE `kind` = 'destroy';
