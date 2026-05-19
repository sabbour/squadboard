UPDATE issues
   SET status = 'todo',
       updated_at = NOW()
 WHERE status = 'ready';

UPDATE column_meta
   SET column_id = 'todo',
       label = 'To Do',
       description = 'Committed work, ready to pick up. The next thing on deck.',
       semantic = 'ready',
       updated_at = NOW()
 WHERE column_id = 'ready';
