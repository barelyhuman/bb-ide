UPDATE host_daemon_commands
SET payload = json_object(
  'type',
  'host.sync_runtime_material',
  'version',
  json_extract(payload, '$.version')
)
WHERE type = 'host.sync_runtime_material'
  AND json_valid(payload)
  AND json_extract(payload, '$.version') IS NOT NULL;
