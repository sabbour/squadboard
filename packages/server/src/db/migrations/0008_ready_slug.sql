-- Rename the stored Ready-column slug from `todo` to `ready`.
-- Squadboard no longer exposes or depends on the old To Do slug.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'column_status') THEN
    ALTER TYPE column_status ADD VALUE IF NOT EXISTS 'ready';
  END IF;
END $$;

UPDATE issues
   SET status = 'ready',
       updated_at = NOW()
 WHERE status = 'todo';

UPDATE column_meta
   SET label = 'Ready',
       description = 'Committed work that the coordinator and Ralph monitor may pick up next.',
       semantic = 'ready',
       updated_at = NOW()
 WHERE column_id = 'ready';

DELETE FROM column_meta legacy
 WHERE legacy.column_id = 'todo'
   AND EXISTS (
     SELECT 1
       FROM column_meta current
      WHERE current.project_id = legacy.project_id
        AND current.column_id = 'ready'
   );

UPDATE column_meta
   SET column_id = 'ready',
       label = 'Ready',
       description = 'Committed work that the coordinator and Ralph monitor may pick up next.',
       semantic = 'ready',
       updated_at = NOW()
 WHERE column_id = 'todo';
