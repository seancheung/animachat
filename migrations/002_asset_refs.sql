-- AnimaChat schema — 002, asset reference tracking.
--
-- asset_refs materializes which owners (characters, locations, scenes, story
-- documents, playthrough snapshots) reference which uploaded assets. The store
-- rewrites an owner's rows transactionally with every save/delete (see
-- syncAssetRefs in src/lib/store.ts); the prune endpoint reads this table
-- instead of re-parsing every JSON document. Groundwork for the multi-user
-- platform: per-user quotas and event-driven reclamation key on these rows.
--
-- Apply manually to an existing database:
--   docker compose exec -T postgres psql -U animachat -d animachat -f - < migrations/002_asset_refs.sql
--
-- No backfill: rows appear as owners are saved. (Pre-existing databases can be
-- reset, or repopulated by re-saving items — the sync is a full replace.)

CREATE TABLE IF NOT EXISTS asset_refs (
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  PRIMARY KEY (owner_kind, owner_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_refs_asset ON asset_refs(asset_id);
