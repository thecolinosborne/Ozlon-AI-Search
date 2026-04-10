-- Fix: Prevent users from self-elevating privilege flags via profile UPDATE
-- Add a trigger that blocks users from modifying protected columns

CREATE OR REPLACE FUNCTION public.protect_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Preserve server-set privilege columns; users cannot change these
  NEW.is_premium := OLD.is_premium;
  NEW.voice_cloning_status := OLD.voice_cloning_status;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_profile_privileges
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_privilege_columns();