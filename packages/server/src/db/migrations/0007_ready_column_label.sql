-- Legacy label cleanup kept for databases that still have the old To Do column.
-- 0008 moves the actual stored slug from `todo` to `ready`.

UPDATE column_meta
   SET label = 'Ready',
       description = 'Committed work that the coordinator and Ralph monitor may pick up next.',
       semantic = 'ready',
       updated_at = NOW()
 WHERE column_id = 'todo'
   AND semantic = 'ready'
   AND label IN ('To Do', 'Todo');
