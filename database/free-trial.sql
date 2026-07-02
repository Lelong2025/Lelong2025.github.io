-- Run once after security-hardening.sql in Supabase SQL Editor.
begin;

alter table public.vip_plans
  add column if not exists trial_days integer not null default 30
  check (trial_days between 1 and 365);

alter table public.subscriptions
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz;

create or replace function public.activate_free_trial(p_user_id uuid)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_trial_end timestamptz;
  v_trial_days integer;
begin
  select * into v_subscription
  from public.subscriptions
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.subscriptions (user_id, plan_id, status)
    values (p_user_id, 'chatbox_ai', 'inactive')
    returning * into v_subscription;
  end if;

  if v_subscription.trial_started_at is not null then
    return jsonb_build_object('activated', false, 'reason', 'trial_already_used');
  end if;

  if exists (
    select 1 from public.payments
    where user_id = p_user_id and status = 'paid'
  ) then
    return jsonb_build_object('activated', false, 'reason', 'paid_customer');
  end if;

  select trial_days into v_trial_days
  from public.vip_plans
  where id = 'chatbox_ai' and active = true;
  if v_trial_days is null then
    return jsonb_build_object('activated', false, 'reason', 'trial_unavailable');
  end if;

  v_trial_end := now() + make_interval(days => v_trial_days);
  update public.subscriptions
  set plan_id = 'chatbox_ai', status = 'active', expires_at = v_trial_end,
      trial_started_at = now(), trial_ends_at = v_trial_end, updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object('activated', true, 'trial_days', v_trial_days,
    'trial_ends_at', v_trial_end);
end;
$$;

revoke all on function public.activate_free_trial(uuid) from public, anon, authenticated;
grant execute on function public.activate_free_trial(uuid) to service_role;

-- Keep existing unpaid trials aligned when an admin changes trial_days.
create or replace function public.sync_active_trial_duration(p_trial_days integer)
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_trial_days < 1 or p_trial_days > 365 then
    raise exception 'trial_days must be between 1 and 365';
  end if;

  update public.subscriptions s
  set trial_ends_at = s.trial_started_at + make_interval(days => p_trial_days),
      expires_at = s.trial_started_at + make_interval(days => p_trial_days),
      status = case
        when s.trial_started_at + make_interval(days => p_trial_days) > now() then 'active'
        else 'inactive'
      end,
      updated_at = now()
  where s.trial_started_at is not null
    and not exists (
      select 1 from public.payments p
      where p.user_id = s.user_id and p.status = 'paid'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.sync_active_trial_duration(integer)
  from public, anon, authenticated;
grant execute on function public.sync_active_trial_duration(integer) to service_role;

commit;
