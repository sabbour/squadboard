UPDATE column_meta
   SET label = 'To Do',
       description = 'Committed work, ready to pick up. The next thing on deck.',
       updated_at = NOW()
 WHERE column_id = 'todo'
   AND semantic = 'ready'
   AND label = 'Ready';
