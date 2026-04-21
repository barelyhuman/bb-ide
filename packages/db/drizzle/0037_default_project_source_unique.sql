UPDATE `project_sources`
SET `is_default` = 0
WHERE
  `is_default` = 1
  AND `id` NOT IN (
    SELECT `id`
    FROM (
      SELECT
        `id`,
        row_number() OVER (
          PARTITION BY `project_id`
          ORDER BY `updated_at` DESC, `created_at` DESC, `id` DESC
        ) AS `default_rank`
      FROM `project_sources`
      WHERE `is_default` = 1
    )
    WHERE `default_rank` = 1
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `project_sources_default_project_idx`
ON `project_sources` (`project_id`)
WHERE `is_default` = 1;
