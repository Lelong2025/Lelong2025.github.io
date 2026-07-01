-- ============================================================
-- 004_admin_rpcs.sql
-- Admin RPC functions + get_my_account_info() cho user
-- Tất cả SECURITY DEFINER, check is_admin qua JWT claim
-- Chạy trong Supabase SQL Editor
-- ============================================================

-- ============================================================
-- USER: get_my_account_info() — cho /account.html
-- Trả về profile + subscription + plan + today's usage trong 1 RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_account_info()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile public.profiles;
  v_subscription public.subscriptions;
  v_plan public.vip_plans;
  v_used_today INT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE user_id = v_user_id;
  SELECT * INTO v_subscription FROM public.subscriptions WHERE user_id = v_user_id;

  IF v_subscription.plan_id IS NOT NULL THEN
    SELECT * INTO v_plan FROM public.vip_plans WHERE id = v_subscription.plan_id;
    SELECT COALESCE(message_count, 0) INTO v_used_today
      FROM public.ai_usage
      WHERE user_id = v_user_id
        AND usage_date = (NOW() AT TIME ZONE 'UTC')::DATE;
  END IF;

  RETURN jsonb_build_object(
    'profile',      to_jsonb(v_profile),
    'subscription', to_jsonb(v_subscription),
    'plan',         to_jsonb(v_plan),
    'used_today',   v_used_today,
    'daily_limit',  COALESCE(v_plan.daily_ai_limit, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_account_info() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_account_info() TO authenticated;


-- ============================================================
-- ADMIN: dashboard stats (1 RPC trả về tất cả)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_revenue_total BIGINT;
  v_revenue_month BIGINT;
  v_revenue_today BIGINT;
  v_vip_active INTEGER;
  v_users_total INTEGER;
  v_pv_today INTEGER;
  v_pv_total INTEGER;
BEGIN
  IF NOT ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true) THEN
    RAISE EXCEPTION 'Unauthorized: admin only' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(amount_vnd), 0) INTO v_revenue_total
    FROM public.payments WHERE status = 'paid';
  SELECT COALESCE(SUM(amount_vnd), 0) INTO v_revenue_month
    FROM public.payments
    WHERE status = 'paid'
      AND paid_at >= date_trunc('month', NOW());
  SELECT COALESCE(SUM(amount_vnd), 0) INTO v_revenue_today
    FROM public.payments
    WHERE status = 'paid'
      AND paid_at::date = (NOW() AT TIME ZONE 'UTC')::DATE;

  SELECT COUNT(*) INTO v_vip_active FROM public.subscriptions
    WHERE status = 'active' AND expires_at > NOW();

  SELECT COUNT(*) INTO v_users_total FROM auth.users;

  SELECT COUNT(DISTINCT visitor_id) INTO v_pv_today FROM public.page_views
    WHERE view_date = (NOW() AT TIME ZONE 'UTC')::DATE AND page = 'home';
  SELECT COUNT(DISTINCT visitor_id) INTO v_pv_total FROM public.page_views
    WHERE page = 'home';

  RETURN jsonb_build_object(
    'revenue_total',    v_revenue_total,
    'revenue_month',    v_revenue_month,
    'revenue_today',    v_revenue_today,
    'vip_active_count', v_vip_active,
    'users_total',      v_users_total,
    'page_views_today', v_pv_today,
    'page_views_total', v_pv_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_dashboard_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_dashboard_stats() TO authenticated;


-- ============================================================
-- ADMIN: timeseries cho chart
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_timeseries(
  p_metric TEXT,        -- 'revenue' | 'page_views'
  p_granularity TEXT,   -- 'day' | 'week' | 'month'
  p_periods INT DEFAULT 30
)
RETURNS TABLE(bucket DATE, value BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_metric NOT IN ('revenue', 'page_views') THEN
    RAISE EXCEPTION 'Invalid metric: %', p_metric;
  END IF;
  IF p_granularity NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'Invalid granularity: %', p_granularity;
  END IF;

  IF p_metric = 'revenue' THEN
    RETURN QUERY
      SELECT date_trunc(p_granularity, paid_at)::DATE AS bucket,
             COALESCE(SUM(amount_vnd), 0)::BIGINT AS value
      FROM public.payments
      WHERE status = 'paid'
        AND paid_at >= date_trunc(p_granularity, NOW())
                        - (p_periods::TEXT || ' ' || p_granularity)::INTERVAL
      GROUP BY bucket
      ORDER BY bucket;
  ELSE
    RETURN QUERY
      WITH days AS (
        SELECT generate_series(
          (NOW() - (p_periods::TEXT || ' ' || p_granularity)::INTERVAL)::DATE,
          (NOW() AT TIME ZONE 'UTC')::DATE,
          ('1 ' || p_granularity)::INTERVAL
        )::DATE AS bucket
      )
      SELECT d.bucket,
             COALESCE(COUNT(DISTINCT pv.visitor_id), 0)::BIGINT AS value
      FROM days d
      LEFT JOIN public.page_views pv
        ON pv.view_date = d.bucket AND pv.page = 'home'
      GROUP BY d.bucket
      ORDER BY d.bucket;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_timeseries(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_timeseries(TEXT, TEXT, INT) TO authenticated;


-- ============================================================
-- ADMIN: list users (paginated, with VIP + total spent)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE(
  user_id UUID,
  email TEXT,
  display_name TEXT,
  plan_id TEXT,
  vip_status TEXT,
  vip_expires_at TIMESTAMPTZ,
  total_spent_vnd BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      u.id::UUID AS user_id,
      u.email::TEXT AS email,
      p.display_name,
      s.plan_id,
      s.status AS vip_status,
      s.expires_at AS vip_expires_at,
      COALESCE(SUM(pay.amount_vnd) FILTER (WHERE pay.status = 'paid'), 0)::BIGINT AS total_spent_vnd,
      u.created_at
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
    LEFT JOIN public.subscriptions s ON s.user_id = u.id
    LEFT JOIN public.payments pay ON pay.user_id = u.id
    WHERE p_search IS NULL
       OR u.email ILIKE '%' || p_search || '%'
       OR p.display_name ILIKE '%' || p_search || '%'
    GROUP BY u.id, u.email, p.display_name, s.plan_id, s.status, s.expires_at, u.created_at
    ORDER BY u.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users(INT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users(INT, INT, TEXT) TO authenticated;


-- ============================================================
-- ADMIN: count users (cho pagination)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_count_users(p_search TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NOT ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE p_search IS NULL
     OR u.email ILIKE '%' || p_search || '%'
     OR p.display_name ILIKE '%' || p_search || '%';
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_count_users(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_count_users(TEXT) TO authenticated;


-- ============================================================
-- ADMIN: get payment history của 1 user
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_user_payments(p_user_id UUID)
RETURNS TABLE(
  id UUID,
  plan_id TEXT,
  amount_vnd INT,
  payment_code TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT id, plan_id, amount_vnd, payment_code, status, created_at, paid_at
    FROM public.payments
    WHERE user_id = p_user_id
    ORDER BY created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_user_payments(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_payments(UUID) TO authenticated;


-- ============================================================
-- ADMIN: update vip_plans (edit only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_update_vip_plan(
  p_plan_id TEXT,
  p_price_vnd INT DEFAULT NULL,
  p_duration_days INT DEFAULT NULL,
  p_daily_ai_limit INT DEFAULT NULL,
  p_payment_prefix TEXT DEFAULT NULL,
  p_active BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated public.vip_plans;
BEGIN
  IF NOT ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.vip_plans SET
    price_vnd       = COALESCE(p_price_vnd,       price_vnd),
    duration_days   = COALESCE(p_duration_days,   duration_days),
    daily_ai_limit  = COALESCE(p_daily_ai_limit,  daily_ai_limit),
    payment_prefix  = COALESCE(p_payment_prefix,  payment_prefix),
    active          = COALESCE(p_active,          active),
    updated_at      = NOW()
  WHERE id = p_plan_id
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found: %', p_plan_id;
  END IF;

  RETURN to_jsonb(v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_vip_plan(TEXT, INT, INT, INT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_vip_plan(TEXT, INT, INT, INT, TEXT, BOOLEAN) TO authenticated;
