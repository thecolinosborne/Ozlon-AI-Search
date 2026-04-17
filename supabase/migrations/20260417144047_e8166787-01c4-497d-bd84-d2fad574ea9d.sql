CREATE OR REPLACE FUNCTION public.store_user_secret(
  _connection_id uuid,
  _user_id uuid,
  _plaintext text,
  _encryption_key bytea,
  _secret_name text DEFAULT 'api_key'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pgsodium'
AS $$
DECLARE
  v_owner uuid;
  v_nonce bytea;
  v_ciphertext bytea;
  v_last4 text;
BEGIN
  IF _user_id IS NULL OR _connection_id IS NULL OR _plaintext IS NULL OR _encryption_key IS NULL THEN
    RAISE EXCEPTION 'connection_id, user_id, plaintext, and encryption key required';
  END IF;

  SELECT user_id INTO v_owner FROM public.integration_connections WHERE id = _connection_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'connection not found';
  END IF;
  IF v_owner <> _user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_nonce := pgsodium.crypto_secretbox_noncegen();
  v_ciphertext := pgsodium.crypto_secretbox(convert_to(_plaintext, 'utf8'), v_nonce, _encryption_key);
  v_last4 := CASE WHEN length(_plaintext) >= 4 THEN right(_plaintext, 4) ELSE _plaintext END;

  INSERT INTO public.integration_credentials (
    connection_id, user_id, secret_name, secret_ciphertext, secret_nonce, last4, rotated_at
  ) VALUES (
    _connection_id, _user_id, _secret_name, v_ciphertext, v_nonce, v_last4, now()
  )
  ON CONFLICT (connection_id, secret_name) DO UPDATE
    SET secret_ciphertext = EXCLUDED.secret_ciphertext,
        secret_nonce      = EXCLUDED.secret_nonce,
        last4             = EXCLUDED.last4,
        rotated_at        = now();
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integration_credentials_connection_secret_unique'
  ) THEN
    ALTER TABLE public.integration_credentials
      ADD CONSTRAINT integration_credentials_connection_secret_unique
      UNIQUE (connection_id, secret_name);
  END IF;
END $$;