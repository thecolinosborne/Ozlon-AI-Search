-- Ensure pgcrypto is available
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Replace store_user_secret to use pgcrypto AES-256-GCM (encrypt_iv) instead of pgsodium
CREATE OR REPLACE FUNCTION public.store_user_secret(
  _connection_id uuid,
  _user_id uuid,
  _plaintext text,
  _encryption_key bytea,
  _secret_name text DEFAULT 'api_key'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_owner uuid;
  v_iv bytea;
  v_ciphertext bytea;
  v_last4 text;
BEGIN
  IF _user_id IS NULL OR _connection_id IS NULL OR _plaintext IS NULL OR _encryption_key IS NULL THEN
    RAISE EXCEPTION 'connection_id, user_id, plaintext, and encryption key required';
  END IF;

  IF octet_length(_encryption_key) <> 32 THEN
    RAISE EXCEPTION 'encryption key must be exactly 32 bytes';
  END IF;

  SELECT user_id INTO v_owner FROM public.integration_connections WHERE id = _connection_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'connection not found';
  END IF;
  IF v_owner <> _user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 12-byte random IV recommended for AES-GCM
  v_iv := extensions.gen_random_bytes(12);
  v_ciphertext := extensions.encrypt_iv(
    convert_to(_plaintext, 'utf8'),
    _encryption_key,
    v_iv,
    'aes-cbc/pad:pkcs'
  );
  v_last4 := CASE WHEN length(_plaintext) >= 4 THEN right(_plaintext, 4) ELSE _plaintext END;

  INSERT INTO public.integration_credentials (
    connection_id, user_id, secret_name, secret_ciphertext, secret_nonce, last4, rotated_at
  ) VALUES (
    _connection_id, _user_id, _secret_name, v_ciphertext, v_iv, v_last4, now()
  )
  ON CONFLICT (connection_id, secret_name) DO UPDATE
    SET secret_ciphertext = EXCLUDED.secret_ciphertext,
        secret_nonce      = EXCLUDED.secret_nonce,
        last4             = EXCLUDED.last4,
        rotated_at        = now();
END;
$function$;

-- Replace get_user_secret to use pgcrypto decrypt_iv
CREATE OR REPLACE FUNCTION public.get_user_secret(
  _connection_id uuid,
  _user_id uuid,
  _secret_name text DEFAULT 'api_key'::text,
  _encryption_key bytea DEFAULT NULL::bytea
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_ciphertext bytea;
  v_iv bytea;
  v_owner uuid;
  v_plaintext text;
BEGIN
  IF _user_id IS NULL OR _connection_id IS NULL THEN
    RAISE EXCEPTION 'connection_id and user_id required';
  END IF;

  SELECT secret_ciphertext, secret_nonce, user_id
    INTO v_ciphertext, v_iv, v_owner
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

  IF octet_length(_encryption_key) <> 32 THEN
    RAISE EXCEPTION 'encryption key must be exactly 32 bytes';
  END IF;

  v_plaintext := convert_from(
    extensions.decrypt_iv(v_ciphertext, _encryption_key, v_iv, 'aes-cbc/pad:pkcs'),
    'utf8'
  );

  UPDATE public.integration_credentials
     SET last_used_at = now()
   WHERE connection_id = _connection_id
     AND secret_name = _secret_name;

  RETURN v_plaintext;
END;
$function$;

-- Make sure callers (service_role used by edge functions) can execute
GRANT EXECUTE ON FUNCTION public.store_user_secret(uuid, uuid, text, bytea, text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_secret(uuid, uuid, text, bytea) TO service_role, authenticated;