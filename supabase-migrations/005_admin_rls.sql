-- ============================================================
-- 005_admin_rls.sql
-- Admin RLS policies — cho phép is_admin đọc all user data
-- Phải chạy SAU khi đã grant admin cho user (Task 2.2)
-- ============================================================

-- profiles
DROP POLICY IF EXISTS "admin_read_all_profiles" ON public.profiles;
CREATE POLICY "admin_read_all_profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- subscriptions
DROP POLICY IF EXISTS "admin_read_all_subscriptions" ON public.subscriptions;
CREATE POLICY "admin_read_all_subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- payments
DROP POLICY IF EXISTS "admin_read_all_payments" ON public.payments;
CREATE POLICY "admin_read_all_payments" ON public.payments
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- ai_usage
DROP POLICY IF EXISTS "admin_read_all_ai_usage" ON public.ai_usage;
CREATE POLICY "admin_read_all_ai_usage" ON public.ai_usage
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- vip_plans (admin xem all kể cả inactive)
DROP POLICY IF EXISTS "admin_read_all_vip_plans" ON public.vip_plans;
CREATE POLICY "admin_read_all_vip_plans" ON public.vip_plans
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- page_views (admin xem all)
DROP POLICY IF EXISTS "admin_read_all_page_views" ON public.page_views;
CREATE POLICY "admin_read_all_page_views" ON public.page_views
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);
