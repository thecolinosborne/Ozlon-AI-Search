-- Realtime broadcast authorization: only allow users to subscribe to topics
-- that start with their own user id, e.g. "<uid>:chat", "<uid>:tasks".
-- This has no effect on postgres_changes subscriptions (those use table RLS).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages'
  ) THEN
    BEGIN
      EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
    EXCEPTION WHEN insufficient_privilege THEN
      -- Already enabled or managed by realtime; ignore.
      NULL;
    END;

    -- Drop old policy if it exists so this migration is idempotent
    BEGIN
      EXECUTE 'DROP POLICY IF EXISTS "User scoped realtime topics" ON realtime.messages';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      EXECUTE $p$
        CREATE POLICY "User scoped realtime topics"
        ON realtime.messages
        FOR SELECT TO authenticated
        USING (
          realtime.topic() LIKE auth.uid()::text || ':%'
        )
      $p$;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END IF;
END $$;