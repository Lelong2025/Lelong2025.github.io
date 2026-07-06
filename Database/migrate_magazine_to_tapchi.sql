BEGIN;

-- 0. Xóa bảng admin_users dư thừa
DROP TABLE IF EXISTS public.admin_users CASCADE;

-- 1. Bổ sung các cột cần thiết từ Magazine vào bảng profiles của Tạp chí
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'client' CHECK (role IN ('admin', 'client')),
ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';


-- 2. Tạo hoặc sửa đổi function check quyền Admin dựa thẳng vào role trong bảng profiles
CREATE OR REPLACE FUNCTION public.is_magazine_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE user_id = auth.uid() AND role = 'admin'
    );
$$;

-- 3. Tạo bảng magazine_workspaces (Quản lý trạng thái soạn thảo bài báo)
CREATE TABLE IF NOT EXISTS public.magazine_workspaces (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workspace_id text NOT NULL DEFAULT 'default',
    state jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, workspace_id),
    CONSTRAINT magazine_workspaces_state_is_object
        CHECK (jsonb_typeof(state) = 'object')
);

ALTER TABLE public.magazine_workspaces ENABLE ROW LEVEL SECURITY;

-- Cấp quyền bảo mật RLS cho magazine_workspaces
DROP POLICY IF EXISTS "Users can read own magazine workspaces" ON public.magazine_workspaces;
CREATE POLICY "Users can read own magazine workspaces"
ON public.magazine_workspaces FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own magazine workspaces" ON public.magazine_workspaces;
CREATE POLICY "Users can create own magazine workspaces"
ON public.magazine_workspaces FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own magazine workspaces" ON public.magazine_workspaces;
CREATE POLICY "Users can update own magazine workspaces"
ON public.magazine_workspaces FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own magazine workspaces" ON public.magazine_workspaces;
CREATE POLICY "Users can delete own magazine workspaces"
ON public.magazine_workspaces FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.magazine_workspaces TO authenticated;

-- 4. Tạo bảng article_submissions (Nhận bài báo client gửi lên)
CREATE TABLE IF NOT EXISTS public.article_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    article_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    exported_format text NOT NULL CHECK (exported_format IN ('docx', 'pdf')),
    exported_file_path text,
    exported_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'imported', 'archived')),
    CONSTRAINT article_submissions_snapshot_is_object
        CHECK (jsonb_typeof(article_snapshot) = 'object')
);

ALTER TABLE public.article_submissions ENABLE ROW LEVEL SECURITY;

-- Cấp quyền bảo mật RLS cho article_submissions
DROP POLICY IF EXISTS "Users can read own submissions" ON public.article_submissions;
CREATE POLICY "Users can read own submissions"
ON public.article_submissions FOR SELECT
TO authenticated
USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Admins can read all submissions" ON public.article_submissions;
CREATE POLICY "Admins can read all submissions"
ON public.article_submissions FOR SELECT
TO authenticated
USING (public.is_magazine_admin());

DROP POLICY IF EXISTS "Users can create own submissions" ON public.article_submissions;
CREATE POLICY "Users can create own submissions"
ON public.article_submissions FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can update own submissions" ON public.article_submissions;
CREATE POLICY "Users can update own submissions"
ON public.article_submissions FOR UPDATE
TO authenticated
USING (auth.uid() = owner_id OR public.is_magazine_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE public.article_submissions TO authenticated;

-- 5. Cấp quyền đọc/ghi profiles cho admin
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (public.is_magazine_admin());

GRANT SELECT, UPDATE(display_name, updated_at, role, email) ON public.profiles TO authenticated;

-- 6. Đăng ký các Storage Buckets cho hệ thống Magazine
INSERT INTO storage.buckets (id, name, public)
VALUES ('article-assets', 'article-assets', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('article-exports', 'article-exports', false)
ON CONFLICT (id) DO NOTHING;

-- Cấp quyền bảo mật Storage cho article-assets (Public assets của bài báo)
DROP POLICY IF EXISTS "Users can read own article assets" ON storage.objects;
CREATE POLICY "Users can read own article assets"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'article-assets'
    AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can upload own article assets" ON storage.objects;
CREATE POLICY "Users can upload own article assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'article-assets'
    AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can update own article assets" ON storage.objects;
CREATE POLICY "Users can update own article assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'article-assets'
    AND split_part(name, '/', 1) = auth.uid()::text
);

-- Cấp quyền bảo mật Storage cho article-exports (File xuất bản docx, pdf)
DROP POLICY IF EXISTS "Users can read own exports and admins can read all" ON storage.objects;
CREATE POLICY "Users can read own exports and admins can read all"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'article-exports'
    AND (
        split_part(name, '/', 1) = auth.uid()::text
        OR public.is_magazine_admin()
    )
);

DROP POLICY IF EXISTS "Users can upload own exports" ON storage.objects;
CREATE POLICY "Users can upload own exports"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'article-exports'
    AND split_part(name, '/', 1) = auth.uid()::text
);

COMMIT;
