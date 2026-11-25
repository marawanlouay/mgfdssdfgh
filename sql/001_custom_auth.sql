-- Run after reviewing your existing public.users table in Supabase SQL Editor.
-- Supabase Auth was previously used; custom auth needs no auth_user_id requirement.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email VARCHAR(254);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'player';
ALTER TABLE public.users ALTER COLUMN auth_user_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chessnest_users_email_unique ON public.users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chessnest_users_username_unique ON public.users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS chessnest_progress_user_lesson_unique ON public.user_progress(user_id,lesson_id);
