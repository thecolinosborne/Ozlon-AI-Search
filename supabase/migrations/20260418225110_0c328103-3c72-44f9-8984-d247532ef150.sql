-- Dedupe duplicate integration_connections per (user_id, provider).
-- Keep the most recently updated row; reassign credentials/sync_runs from older rows; delete the older rows.

WITH ranked AS (
  SELECT id,
         user_id,
         provider,
         updated_at,
         ROW_NUMBER() OVER (PARTITION BY user_id, provider ORDER BY updated_at DESC, created_at DESC) AS rn
  FROM public.integration_connections
),
keepers AS (
  SELECT user_id, provider, id AS keeper_id FROM ranked WHERE rn = 1
),
losers AS (
  SELECT r.id AS loser_id, k.keeper_id
  FROM ranked r
  JOIN keepers k USING (user_id, provider)
  WHERE r.rn > 1
)
-- Move credentials from losers to keepers (skip if keeper already has same secret_name)
UPDATE public.integration_credentials cred
   SET connection_id = l.keeper_id
  FROM losers l
 WHERE cred.connection_id = l.loser_id
   AND NOT EXISTS (
     SELECT 1 FROM public.integration_credentials existing
      WHERE existing.connection_id = l.keeper_id
        AND existing.secret_name = cred.secret_name
   );

-- Drop credentials still attached to losers (duplicates of secrets the keeper already has).
DELETE FROM public.integration_credentials cred
 USING (
  SELECT r.id AS loser_id
  FROM (
    SELECT id, user_id, provider,
           ROW_NUMBER() OVER (PARTITION BY user_id, provider ORDER BY updated_at DESC, created_at DESC) AS rn
    FROM public.integration_connections
  ) r
  WHERE r.rn > 1
 ) l
 WHERE cred.connection_id = l.loser_id;

-- Reassign sync runs to the keeper.
UPDATE public.integration_sync_runs r
   SET connection_id = k.keeper_id
  FROM (
    SELECT user_id, provider, id AS keeper_id
    FROM (
      SELECT id, user_id, provider,
             ROW_NUMBER() OVER (PARTITION BY user_id, provider ORDER BY updated_at DESC, created_at DESC) AS rn
      FROM public.integration_connections
    ) x
    WHERE rn = 1
  ) k
  JOIN (
    SELECT id AS loser_id, user_id, provider
    FROM (
      SELECT id, user_id, provider,
             ROW_NUMBER() OVER (PARTITION BY user_id, provider ORDER BY updated_at DESC, created_at DESC) AS rn
      FROM public.integration_connections
    ) y
    WHERE rn > 1
  ) l USING (user_id, provider)
 WHERE r.connection_id = l.loser_id;

-- Delete the duplicate (older) rows.
DELETE FROM public.integration_connections
 WHERE id IN (
   SELECT id FROM (
     SELECT id,
            ROW_NUMBER() OVER (PARTITION BY user_id, provider ORDER BY updated_at DESC, created_at DESC) AS rn
     FROM public.integration_connections
   ) z WHERE rn > 1
 );

-- Enforce one row per (user_id, provider) going forward to prevent this class of bug at scale.
-- The existing constraint includes auth_type + external_account_id (which is NULL-distinct), so duplicates were possible.
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_user_provider_uniq
  ON public.integration_connections (user_id, provider);