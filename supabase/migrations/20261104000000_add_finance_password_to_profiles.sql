-- Add finance_password_hash column to profiles table
-- This stores a hashed version of the numeric financial password

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS finance_password_hash TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.finance_password_hash IS 'SHA-256 hash of the numeric financial access password (salted with user ID)';

-- Create index for faster lookups (optional, but useful if querying by this field)
-- CREATE INDEX IF NOT EXISTS idx_profiles_finance_password_hash ON public.profiles(finance_password_hash);