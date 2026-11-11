begin;

-- Preserve current paid/trial access until an admin explicitly disables it.
alter table public.service_products
  add column if not exists requires_plan boolean not null default true;

comment on column public.service_products.requires_plan is
  'Whether service access requires a plan/trial. Configurable for magazine_export and magazine_ai_review.';

commit;
