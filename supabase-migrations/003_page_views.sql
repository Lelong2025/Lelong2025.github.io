-- ============================================================
-- 003_page_views.sql
-- Bảng page_views + function track_page_view()
-- Chạy trong Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.page_views (
  visitor_id  TEXT NOT NULL,
  view_date   DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')::DATE,
  page        TEXT NOT NULL,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (visitor_id, view_date, page)
);

CREATE INDEX IF NOT EXISTS page_views_date_page_idx
  ON public.page_views(view_date, page);

ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;

-- Ai cũng insert được (anon + authenticated)
CREATE POLICY "anyone_insert_page_views" ON public.page_views
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Track 1 page view (idempotent trong cùng ngày)
CREATE OR REPLACE FUNCTION public.track_page_view(
  p_visitor_id TEXT,
  p_page TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.page_views (visitor_id, view_date, page, viewed_at)
  VALUES (p_visitor_id, (NOW() AT TIME ZONE 'UTC')::DATE, p_page, NOW())
  ON CONFLICT (visitor_id, view_date, page) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.track_page_view(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_page_view(TEXT, TEXT) TO anon, authenticated;
