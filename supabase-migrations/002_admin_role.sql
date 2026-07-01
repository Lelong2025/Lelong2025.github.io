-- ============================================================
-- 002_admin_role.sql
-- Bảng admin_users + function grant_admin()
-- Chạy trong Supabase SQL Editor với role postgres (mặc định)
-- ============================================================

-- Bảng track admin (queryable, dễ thêm/bớt admin)
CREATE TABLE IF NOT EXISTS public.admin_users (
  email       TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed admin đầu tiên
INSERT INTO public.admin_users (email) VALUES ('phuonglong@lhu.edu.vn')
ON CONFLICT (email) DO NOTHING;

-- Function: set app_metadata.is_admin = true cho user
-- CHỈ service_role mới được gọi (vì modify auth.users)
CREATE OR REPLACE FUNCTION public.grant_admin(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Đảm bảo email có trong admin_users
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = p_email) THEN
    RAISE EXCEPTION 'Email % is not in admin_users table', p_email;
  END IF;

  -- Tìm user theo email
  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_email;
  END IF;

  -- Set app_metadata.is_admin = true
  UPDATE auth.users
    SET raw_app_meta_data =
      COALESCE(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('is_admin', true)
    WHERE id = v_user_id;
END;
$$;

-- Lockdown: chỉ service_role được gọi grant_admin
REVOKE ALL ON FUNCTION public.grant_admin(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_admin(TEXT) TO service_role;

-- Sau khi chạy file này, chạy tiếp:
--   SELECT public.grant_admin('phuonglong@lhu.edu.vn');
-- để set app_metadata.is_admin=true cho user này.
