-- Add system_name column to profiles
ALTER TABLE public.profiles 
ADD COLUMN system_name TEXT DEFAULT 'Ozlon';