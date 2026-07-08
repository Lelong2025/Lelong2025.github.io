begin;

-- For monthly plans, service_plans.credits and monthly_balance represent the
-- daily allowance. Unused allowance does not carry over to another UTC day.
update public.user_entitlements e
set monthly_balance = p.credits,
    updated_at = now()
from public.service_plans p
where e.monthly_plan_id = p.id
  and p.billing_type = 'monthly';

create or replace function public.reserve_service_usage(
  p_user_id uuid,
  p_product_code text,
  p_action text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ent public.user_entitlements%rowtype;
  v_existing public.service_usage%rowtype;
  v_plan public.service_plans%rowtype;
  v_wallet public.user_wallets%rowtype;
  v_pref public.auto_renew_preferences%rowtype;
  v_source text;
  v_usage integer;
  v_reservation_id uuid;
  v_today date := (now() at time zone 'utc')::date;
begin
  if coalesce(trim(p_idempotency_key), '') = '' then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_idempotency_key');
  end if;

  select * into v_existing from public.service_usage
  where user_id = p_user_id and product_code = p_product_code
    and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'allowed', v_existing.status in ('reserved', 'consumed'),
      'reservation_id', v_existing.id,
      'status', v_existing.status,
      'source', v_existing.source
    );
  end if;

  select * into v_ent from public.user_entitlements
  where user_id = p_user_id and product_code = p_product_code
  for update;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'service_unavailable');
  end if;

  if v_ent.trial_ends_at is not null and v_ent.trial_ends_at > now() then
    insert into public.service_daily_usage (user_id, product_code, usage_date, usage_count)
    values (p_user_id, p_product_code, v_today, 1)
    on conflict (user_id, product_code, usage_date)
    do update set usage_count = public.service_daily_usage.usage_count + 1, updated_at = now()
    returning usage_count into v_usage;
    if v_usage > v_ent.trial_daily_limit then
      update public.service_daily_usage set usage_count = usage_count - 1, updated_at = now()
      where user_id = p_user_id and product_code = p_product_code and usage_date = v_today;
      return jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'limit', v_ent.trial_daily_limit);
    end if;
    v_source := 'trial';
  elsif v_ent.monthly_ends_at is not null and v_ent.monthly_ends_at > now() and v_ent.monthly_balance > 0 then
    insert into public.service_daily_usage (user_id, product_code, usage_date, usage_count)
    values (p_user_id, p_product_code, v_today, 1)
    on conflict (user_id, product_code, usage_date)
    do update set usage_count = public.service_daily_usage.usage_count + 1, updated_at = now()
    returning usage_count into v_usage;
    if v_usage > v_ent.monthly_balance then
      update public.service_daily_usage set usage_count = usage_count - 1, updated_at = now()
      where user_id = p_user_id and product_code = p_product_code and usage_date = v_today;
      return jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'limit', v_ent.monthly_balance);
    end if;
    v_source := 'monthly';
  elsif v_ent.credit_balance > 0 then
    update public.user_entitlements set credit_balance = credit_balance - 1, updated_at = now()
    where user_id = p_user_id and product_code = p_product_code;
    v_source := 'credits';
  else
    select * into v_pref from public.auto_renew_preferences
    where user_id = p_user_id and product_code = p_product_code and enabled = true;
    if not found then
      return jsonb_build_object('allowed', false, 'reason', 'credits_exhausted');
    end if;
    select * into v_plan from public.service_plans
    where id = v_pref.plan_id and product_code = p_product_code and active = true;
    if not found then
      return jsonb_build_object('allowed', false, 'reason', 'renewal_plan_unavailable');
    end if;
    select * into v_wallet from public.user_wallets where user_id = p_user_id for update;
    if not found or v_wallet.balance_vnd < v_plan.price_vnd then
      return jsonb_build_object('allowed', false, 'reason', 'wallet_insufficient', 'required_vnd', v_plan.price_vnd);
    end if;
    if v_plan.billing_type = 'monthly' then
      select coalesce(usage_count, 0) into v_usage
      from public.service_daily_usage
      where user_id = p_user_id and product_code = p_product_code and usage_date = v_today;
      if coalesce(v_usage, 0) >= v_plan.credits then
        return jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'limit', v_plan.credits);
      end if;
    end if;
    update public.user_wallets
    set balance_vnd = balance_vnd - v_plan.price_vnd, updated_at = now()
    where user_id = p_user_id;
    if v_plan.billing_type = 'monthly' then
      update public.user_entitlements
      set monthly_plan_id = v_plan.id,
          monthly_started_at = now(),
          monthly_ends_at = now() + make_interval(days => v_plan.duration_days),
          monthly_balance = v_plan.credits,
          updated_at = now()
      where user_id = p_user_id and product_code = p_product_code;
      insert into public.service_daily_usage (user_id, product_code, usage_date, usage_count)
      values (p_user_id, p_product_code, v_today, 1)
      on conflict (user_id, product_code, usage_date)
      do update set usage_count = public.service_daily_usage.usage_count + 1, updated_at = now()
      returning usage_count into v_usage;
      v_source := 'monthly';
    else
      update public.user_entitlements
      set credit_balance = credit_balance + v_plan.credits - 1, updated_at = now()
      where user_id = p_user_id and product_code = p_product_code;
      v_source := 'credits';
    end if;
  end if;

  insert into public.service_usage (
    user_id, product_code, action, units, source, status, idempotency_key, metadata
  ) values (
    p_user_id, p_product_code, p_action, 1, v_source, 'reserved', p_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_reservation_id;

  select * into v_ent from public.user_entitlements
  where user_id = p_user_id and product_code = p_product_code;
  select * into v_wallet from public.user_wallets where user_id = p_user_id;
  return jsonb_build_object(
    'allowed', true,
    'reservation_id', v_reservation_id,
    'source', v_source,
    'credit_balance', v_ent.credit_balance,
    'monthly_daily_limit', v_ent.monthly_balance,
    'daily_usage', coalesce(v_usage, 0),
    'daily_remaining', case when v_source in ('trial', 'monthly')
      then greatest((case when v_source = 'trial' then v_ent.trial_daily_limit else v_ent.monthly_balance end) - coalesce(v_usage, 0), 0)
      else null end,
    'remaining_credits', v_ent.credit_balance + case when v_source in ('trial', 'monthly')
      then greatest((case when v_source = 'trial' then v_ent.trial_daily_limit else v_ent.monthly_balance end) - coalesce(v_usage, 0), 0)
      else 0 end,
    'wallet_balance_vnd', coalesce(v_wallet.balance_vnd, 0)
  );
end;
$function$;

create or replace function public.finalize_service_usage(
  p_user_id uuid,
  p_reservation_id uuid,
  p_success boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_usage public.service_usage%rowtype;
begin
  select * into v_usage from public.service_usage
  where id = p_reservation_id and user_id = p_user_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'reservation_not_found'); end if;
  if v_usage.status <> 'reserved' then
    return jsonb_build_object('ok', true, 'status', v_usage.status);
  end if;

  if p_success then
    update public.service_usage set status = 'consumed', finalized_at = now()
    where id = v_usage.id;
    return jsonb_build_object('ok', true, 'status', 'consumed');
  end if;

  if v_usage.source in ('trial', 'monthly') then
    update public.service_daily_usage
    set usage_count = greatest(usage_count - v_usage.units, 0), updated_at = now()
    where user_id = v_usage.user_id and product_code = v_usage.product_code
      and usage_date = ((v_usage.created_at at time zone 'utc')::date);
  elsif v_usage.source in ('credits', 'wallet_renewal') then
    update public.user_entitlements
    set credit_balance = credit_balance + v_usage.units, updated_at = now()
    where user_id = v_usage.user_id and product_code = v_usage.product_code;
  end if;

  update public.service_usage set status = 'refunded', finalized_at = now()
  where id = v_usage.id;
  return jsonb_build_object('ok', true, 'status', 'refunded');
end;
$function$;

commit;
