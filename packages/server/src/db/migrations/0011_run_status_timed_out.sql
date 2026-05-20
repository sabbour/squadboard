DO $$ BEGIN
  ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'timed_out';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
