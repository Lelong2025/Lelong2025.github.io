-- Run after database/free-trial.sql to switch paid VIP from dates to usage credits.
begin;

alter table public.vip_plans
  add column if not exists ai_credit_amount integer not null default 30
  check (ai_credit_amount > 0);

alter table public.vip_plans
  add column if not exists ai_wallet_unit_price_vnd integer not null default 1000
  check (ai_wallet_unit_price_vnd > 0);

alter table public.subscriptions
  add column if not exists ai_credits_remaining integer not null default 0
  check (ai_credits_remaining >= 0);

alter table public.subscriptions
  add column if not exists wallet_balance_vnd integer not null default 0
  check (wallet_balance_vnd >= 0);

alter table public.payments
  add column if not exists credits_granted integer not null default 0,
  add column if not exists wallet_amount_vnd integer not null default 0,
  add column if not exists order_type text not null default 'vip_credits',
  add column if not exists sepay_transaction_id text;

grant select (credits_granted, wallet_amount_vnd, order_type) on public.payments to authenticated;

create unique index if not exists payments_sepay_transaction_id_key
  on public.payments (sepay_transaction_id)
  where sepay_transaction_id is not null;

-- Enable Supabase Realtime for account/payment changes.
do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['payments', 'subscriptions', 'ai_usage', 'profiles']
    loop
      if to_regclass(format('public.%I', v_table)) is not null
        and not exists (
          select 1
          from pg_publication_tables
          where pubname = 'supabase_realtime'
            and schemaname = 'public'
            and tablename = v_table
        ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end $$;

update public.vip_plans
set ai_credit_amount = greatest(coalesce(ai_credit_amount, 0), coalesce(daily_ai_limit, 30), 1)
where ai_credit_amount is null or ai_credit_amount <= 0;

update public.vip_plans
set ai_wallet_unit_price_vnd = greatest(coalesce(ai_wallet_unit_price_vnd, 0), 1)
where ai_wallet_unit_price_vnd is null or ai_wallet_unit_price_vnd <= 0;

-- Backfill paid orders that existed before credit-based VIP was introduced.
-- Idempotent: only payments with credits_granted = 0 are converted.
do $$
declare
  v_payment record;
  v_credits integer;
begin
  for v_payment in
    select p.id, p.user_id, p.plan_id, p.order_type
    from public.payments p
    where p.status = 'paid'
      and coalesce(p.credits_granted, 0) = 0
      and coalesce(p.wallet_amount_vnd, 0) = 0
      and coalesce(p.order_type, 'vip_credits') = 'vip_credits'
    order by coalesce(p.paid_at, p.created_at), p.id
  loop
    select greatest(coalesce(vp.ai_credit_amount, vp.daily_ai_limit, 1), 1)
    into v_credits
    from public.vip_plans vp
    where vp.id = v_payment.plan_id;

    v_credits := coalesce(v_credits, 30);

    update public.payments
    set credits_granted = v_credits,
        order_type = 'vip_credits'
    where id = v_payment.id
      and coalesce(credits_granted, 0) = 0;

    insert into public.subscriptions (user_id, plan_id, status, expires_at, ai_credits_remaining)
    values (v_payment.user_id, v_payment.plan_id, 'active', null, v_credits)
    on conflict (user_id) do update
    set plan_id = excluded.plan_id,
        status = 'active',
        expires_at = null,
        ai_credits_remaining = public.subscriptions.ai_credits_remaining + v_credits,
        updated_at = now();
  end loop;
end $$;

-- Reconcile paid users from database facts:
-- remaining credits = total paid credits - AI messages used since first paid order.
do $$
declare
  v_user record;
  v_used integer;
  v_remaining integer;
  v_plan_price integer;
begin
  for v_user in
    select
      p.user_id,
      (array_agg(p.plan_id order by coalesce(p.paid_at, p.created_at) desc, p.id desc))[1] as plan_id,
      min(coalesce(p.paid_at, p.created_at))::date as first_paid_date,
      sum(coalesce(p.credits_granted, 0))::integer as total_credits
    from public.payments p
    where p.status = 'paid'
      and coalesce(p.order_type, 'vip_credits') = 'vip_credits'
    group by p.user_id
  loop
    select coalesce(sum(u.message_count), 0)::integer
    into v_used
    from public.ai_usage u
    where u.user_id = v_user.user_id
      and u.usage_date >= v_user.first_paid_date;

    v_remaining := greatest(coalesce(v_user.total_credits, 0) - coalesce(v_used, 0), 0);

    select greatest(coalesce(vp.price_vnd, 0), 1)
    into v_plan_price
    from public.vip_plans vp
    where vp.id = v_user.plan_id;

    insert into public.subscriptions (user_id, plan_id, status, expires_at, ai_credits_remaining)
    values (
      v_user.user_id,
      v_user.plan_id,
      case when v_remaining > 0 then 'active' else 'inactive' end,
      null,
      v_remaining
    )
    on conflict (user_id) do update
    set plan_id = excluded.plan_id,
        expires_at = null,
        ai_credits_remaining = v_remaining,
        status = case
          when v_remaining > 0
            or public.subscriptions.wallet_balance_vnd >= coalesce(v_plan_price, 0)
          then 'active'
          else 'inactive'
        end,
        updated_at = now();
  end loop;
end $$;

create or replace function public.consume_ai_message(p_user_id uuid)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_has_paid boolean;
  v_limit integer;
  v_plan_price integer;
  v_credit_amount integer;
  v_today date := current_date;
  v_usage integer;
begin
  select * into v_subscription
  from public.subscriptions
  where user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'vip_required');
  end if;

  select exists (
    select 1 from public.payments
    where user_id = p_user_id and status = 'paid'
  ) into v_has_paid;

  select greatest(coalesce(p.price_vnd, 0), 1),
         greatest(coalesce(p.ai_credit_amount, p.daily_ai_limit, 30), 1)
  into v_plan_price, v_credit_amount
  from public.vip_plans p
  where p.id = v_subscription.plan_id;

  if v_has_paid or coalesce(v_subscription.wallet_balance_vnd, 0) > 0 then
    if coalesce(v_subscription.ai_credits_remaining, 0) <= 0 then
      if coalesce(v_subscription.wallet_balance_vnd, 0) < coalesce(v_plan_price, 0) then
        update public.subscriptions
        set status = 'inactive', updated_at = now()
        where user_id = p_user_id;
        return jsonb_build_object(
          'allowed', false,
          'reason', 'credits_exhausted',
          'remaining_credits', 0,
          'wallet_balance_vnd', coalesce(v_subscription.wallet_balance_vnd, 0),
          'wallet_renew_price_vnd', coalesce(v_plan_price, 0),
          'wallet_unit_price_vnd', coalesce(v_plan_price, 0)
        );
      end if;

      update public.subscriptions
      set wallet_balance_vnd = wallet_balance_vnd - coalesce(v_plan_price, 0),
          ai_credits_remaining = coalesce(v_credit_amount, 30),
          status = 'active',
          updated_at = now()
      where user_id = p_user_id
      returning ai_credits_remaining, wallet_balance_vnd
      into v_subscription.ai_credits_remaining, v_subscription.wallet_balance_vnd;
    end if;

    insert into public.ai_usage (user_id, usage_date, message_count)
    values (p_user_id, v_today, 1)
    on conflict (user_id, usage_date)
    do update set message_count = public.ai_usage.message_count + 1;

    update public.subscriptions
    set ai_credits_remaining = ai_credits_remaining - 1,
        status = case
          when ai_credits_remaining - 1 > 0 or wallet_balance_vnd >= coalesce(v_plan_price, 0) then 'active'
          else 'inactive'
        end,
        updated_at = now()
    where user_id = p_user_id
    returning ai_credits_remaining, wallet_balance_vnd
    into v_subscription.ai_credits_remaining, v_subscription.wallet_balance_vnd;

    select message_count into v_usage
    from public.ai_usage
    where user_id = p_user_id and usage_date = v_today;

    return jsonb_build_object(
      'allowed', true,
      'usage_today', coalesce(v_usage, 0),
      'remaining_credits', coalesce(v_subscription.ai_credits_remaining, 0),
      'wallet_balance_vnd', coalesce(v_subscription.wallet_balance_vnd, 0),
      'wallet_renew_price_vnd', coalesce(v_plan_price, 0),
      'wallet_unit_price_vnd', coalesce(v_plan_price, 0)
    );
  end if;

  if v_subscription.status <> 'active'
    or v_subscription.trial_ends_at is null
    or v_subscription.trial_ends_at <= now() then
    return jsonb_build_object('allowed', false, 'reason', 'vip_required');
  end if;

  select coalesce(p.daily_ai_limit, 30) into v_limit
  from public.vip_plans p
  where p.id = v_subscription.plan_id;

  insert into public.ai_usage (user_id, usage_date, message_count)
  values (p_user_id, v_today, 1)
  on conflict (user_id, usage_date)
  do update set message_count = public.ai_usage.message_count + 1
  returning message_count into v_usage;

  if v_usage > coalesce(v_limit, 30) then
    update public.ai_usage
    set message_count = message_count - 1
    where user_id = p_user_id and usage_date = v_today;
    return jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'limit', coalesce(v_limit, 30));
  end if;

  return jsonb_build_object(
    'allowed', true,
    'limit', coalesce(v_limit, 30),
    'usage_today', coalesce(v_usage, 0),
    'remaining_credits', coalesce(v_subscription.ai_credits_remaining, 0),
    'wallet_balance_vnd', coalesce(v_subscription.wallet_balance_vnd, 0),
    'wallet_renew_price_vnd', coalesce(v_plan_price, 0),
    'wallet_unit_price_vnd', coalesce(v_plan_price, 0)
  );
end;
$$;

create or replace function public.process_sepay_payment(
  p_payment_code text,
  p_transaction_id text,
  p_amount integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_plan public.vip_plans%rowtype;
  v_credits integer;
  v_order_type text;
begin
  select * into v_payment
  from public.payments
  where payment_code = upper(trim(p_payment_code))
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  if v_payment.status = 'paid' then
    return jsonb_build_object('ok', true, 'reason', 'already_paid');
  end if;

  if v_payment.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_pending');
  end if;

  if v_payment.expires_at is not null and v_payment.expires_at <= now() then
    update public.payments
    set status = 'expired'
    where id = v_payment.id;
    return jsonb_build_object('ok', false, 'reason', 'payment_expired');
  end if;

  if exists (
    select 1 from public.payments
    where sepay_transaction_id = p_transaction_id and id <> v_payment.id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_transaction');
  end if;

  if p_amount <> v_payment.amount_vnd then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  v_order_type := coalesce(v_payment.order_type, 'vip_credits');

  select * into v_plan
  from public.vip_plans
  where id = v_payment.plan_id and active = true;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'plan_unavailable');
  end if;

  v_credits := case
    when v_order_type = 'wallet_topup' then 0
    else greatest(coalesce(v_plan.ai_credit_amount, v_plan.daily_ai_limit, 1), 1)
  end;

  update public.payments
  set status = 'paid',
      paid_at = now(),
      credits_granted = v_credits,
      wallet_amount_vnd = case when v_order_type = 'wallet_topup' then v_payment.amount_vnd else 0 end,
      sepay_transaction_id = p_transaction_id
  where id = v_payment.id;

  insert into public.subscriptions (user_id, plan_id, status, expires_at, ai_credits_remaining, wallet_balance_vnd)
  values (
    v_payment.user_id,
    v_payment.plan_id,
    'active',
    null,
    v_credits,
    case when v_order_type = 'wallet_topup' then v_payment.amount_vnd else 0 end
  )
  on conflict (user_id) do update
  set plan_id = excluded.plan_id,
      status = 'active',
      expires_at = null,
      ai_credits_remaining = public.subscriptions.ai_credits_remaining + v_credits,
      wallet_balance_vnd = public.subscriptions.wallet_balance_vnd
        + case when v_order_type = 'wallet_topup' then v_payment.amount_vnd else 0 end,
      updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'credits_granted', v_credits,
    'wallet_amount_vnd', case when v_order_type = 'wallet_topup' then v_payment.amount_vnd else 0 end
  );
end;
$$;

revoke all on function public.consume_ai_message(uuid) from public, anon, authenticated;
revoke all on function public.process_sepay_payment(text, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.consume_ai_message(uuid) to service_role;
grant execute on function public.process_sepay_payment(text, text, integer, jsonb)
  to service_role;

commit;
