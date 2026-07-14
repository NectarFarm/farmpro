-- Persists the enterprise classification chosen at batch creation (layers,
-- broilers, tilapia, ...) instead of re-deriving it later from a free-text
-- species string, which was unreliable for several enterprise types. Nullable
-- so existing batches remain valid; server code falls back to guessing from
-- species for rows created before this column existed.
ALTER TABLE "batches" ADD COLUMN "enterprise" text;
