ALTER TABLE workspaces ADD COLUMN last_ingested_at INTEGER;

UPDATE workspaces
SET last_ingested_at = (
  SELECT MAX(daily_usage_rollups.created_at)
  FROM daily_usage_rollups
  WHERE daily_usage_rollups.workspace_id = workspaces.id
)
WHERE EXISTS (
  SELECT 1
  FROM daily_usage_rollups
  WHERE daily_usage_rollups.workspace_id = workspaces.id
);
