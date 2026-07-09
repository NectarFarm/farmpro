-- Add storage_key (R2 object path) + mime columns to photos.
-- The existing `data` column is kept so legacy base64 photos remain accessible
-- during the migration window. Once all photos are migrated, `data` can be dropped.
ALTER TABLE photos ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS mime text;

-- Same for test screenshots.
ALTER TABLE test_photos ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE test_photos ADD COLUMN IF NOT EXISTS mime text;
