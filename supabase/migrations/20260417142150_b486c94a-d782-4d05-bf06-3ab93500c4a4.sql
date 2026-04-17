
-- Enable pgsodium for encrypted secrets at rest
CREATE EXTENSION IF NOT EXISTS pgsodium;

-- =========================================================
-- 1. integration_credentials — encrypted vault
-- =========================================================
CREATE TABLE IF NOT EXISTS public.integration_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  secret_name text NOT NULL DEFAULT 'api_key',
  -- Encrypted ciphertext (bytea). Encryption performed inside vault-store edge function.
  secret_ciphertext bytea NOT NULL,
  secret_nonce bytea NOT NULL,
  last4 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  last_used_at timestamptz,
  UNIQUE (connection_id, secret_name)
);

CREATE INDEX IF NOT EXISTS idx_integration_credentials_user
  ON public.integration_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_integration_credentials_connection
  ON public.integration_credentials(connection_id);

ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;

-- Owner can see the metadata (NOT the ciphertext via SELECT * — they only need last4/timestamps)
CREATE POLICY "Users can view own credential metadata"
  ON public.integration_credentials
  FOR SELECT
  USING (auth.uid() = user_id);

-- Inserts/updates/deletes go through service role from edge functions only.
-- No INSERT/UPDATE/DELETE policy for public = denied to clients. Service role bypasses RLS.

-- =========================================================
-- 2. credential_audit_log
-- =========================================================
CREATE TABLE IF NOT EXISTS public.credential_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid REFERENCES public.integration_connections(id) ON DELETE SET NULL,
  provider text,
  action text NOT NULL,                 -- 'created' | 'rotated' | 'used' | 'revoked' | 'failed'
  ip_hash text,
  user_agent text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credential_audit_user_created
  ON public.credential_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credential_audit_connection
  ON public.credential_audit_log(connection_id);

ALTER TABLE public.credential_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own audit log"
  ON public.credential_audit_log
  FOR SELECT
  USING (auth.uid() = user_id);
-- Inserts only via service role (edge functions).

-- =========================================================
-- 3. get_user_secret — SECURITY DEFINER, owner-gated
-- Returns decrypted plaintext only when caller owns the connection.
-- Designed to be called from edge functions using service role; the
-- caller MUST verify auth.uid() server-side OR pass user_id and check.
--
-- We require a user_id arg and verify the row belongs to them.
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_user_secret(
  _connection_id uuid,
  _user_id uuid,
  _secret_name text DEFAULT 'api_key',
  _encryption_key bytea DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgsodium
AS $$
DECLARE
  v_ciphertext bytea;
  v_nonce bytea;
  v_owner uuid;
  v_plaintext text;
BEGIN
  IF _user_id IS NULL OR _connection_id IS NULL THEN
    RAISE EXCEPTION 'connection_id and user_id required';
  END IF;

  SELECT secret_ciphertext, secret_nonce, user_id
    INTO v_ciphertext, v_nonce, v_owner
  FROM public.integration_credentials
  WHERE connection_id = _connection_id
    AND secret_name = _secret_name;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_owner <> _user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _encryption_key IS NULL THEN
    RAISE EXCEPTION 'encryption key required';
  END IF;

  v_plaintext := convert_from(
    pgsodium.crypto_secretbox_open(v_ciphertext, v_nonce, _encryption_key),
    'utf8'
  );

  UPDATE public.integration_credentials
     SET last_used_at = now()
   WHERE connection_id = _connection_id
     AND secret_name = _secret_name;

  RETURN v_plaintext;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_secret(uuid, uuid, text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_secret(uuid, uuid, text, bytea) TO service_role;

-- =========================================================
-- 4. ClickUp tables: add nullable user_id (additive, non-breaking)
-- =========================================================
ALTER TABLE public.clickup_integration_state
  ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.clickup_processed_comments
  ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS idx_clickup_state_user
  ON public.clickup_integration_state(user_id);
CREATE INDEX IF NOT EXISTS idx_clickup_processed_user
  ON public.clickup_processed_comments(user_id);

-- Add per-user SELECT policies (existing service_role policy is preserved → webhook keeps working)
DROP POLICY IF EXISTS "Users can view own clickup state" ON public.clickup_integration_state;
CREATE POLICY "Users can view own clickup state"
  ON public.clickup_integration_state
  FOR SELECT
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own clickup processed comments" ON public.clickup_processed_comments;
CREATE POLICY "Users can view own clickup processed comments"
  ON public.clickup_processed_comments
  FOR SELECT
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

-- =========================================================
-- 5. Storage: add missing UPDATE policy on video-uploads
-- =========================================================
DROP POLICY IF EXISTS "Users can update own video uploads" ON storage.objects;
CREATE POLICY "Users can update own video uploads"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'video-uploads' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'video-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
