UPDATE host_operations
SET payload = json_object(
  'appliedVersion',
  json_extract(payload, '$.appliedVersion'),
  'desiredVersion',
  COALESCE(
    json_extract(payload, '$.desiredVersion'),
    json_extract(payload, '$.desiredSnapshot.version')
  )
)
WHERE kind = 'sync_runtime_material'
  AND json_valid(payload)
  AND COALESCE(
    json_extract(payload, '$.desiredVersion'),
    json_extract(payload, '$.desiredSnapshot.version')
  ) IS NOT NULL;
