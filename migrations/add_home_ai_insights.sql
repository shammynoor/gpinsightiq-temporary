create table public.iq_home_insights (
  practice_id uuid primary key references public.iq_practices(id) on delete cascade,
  snapshot text check (snapshot ~ '^[0-9a-f]{64}$'),
  bullets jsonb check (jsonb_typeof(bullets) = 'object' and octet_length(bullets::text) <= 4000),
  generated_at timestamptz,
  last_attempt timestamptz not null,
  attempts_today integer not null check (attempts_today between 1 and 30),
  attempt_id uuid not null
);
alter table public.iq_home_insights enable row level security;
revoke all on public.iq_home_insights from public, anon, authenticated;
grant select (practice_id, snapshot, bullets, generated_at) on public.iq_home_insights to authenticated;
grant select, insert, update on public.iq_home_insights to service_role;
create policy iq_home_insights_read on public.iq_home_insights for select to authenticated
  using (iq_private.iq_can_access(practice_id, false));

create function public.iq_claim_home_insight_refresh(p_practice uuid, p_user uuid, p_attempt uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1 from public.iq_practices p
    join public.iq_memberships m on m.practice_id = p.id
    where p.id = p_practice and p.active and m.user_id = p_user
      and m.status = 'approved' and m.role = 'practice_admin'
  ) or exists (select 1 from public.iq_platform_admins where user_id = p_user) then
    return 'forbidden';
  end if;
  insert into public.iq_home_insights as i (practice_id, last_attempt, attempts_today, attempt_id)
  values (p_practice, v_now, 1, p_attempt)
  on conflict (practice_id) do update set
    last_attempt = v_now,
    attempts_today = case when (i.last_attempt at time zone 'UTC')::date = (v_now at time zone 'UTC')::date
                          then i.attempts_today + 1 else 1 end,
    attempt_id = p_attempt
  where i.last_attempt <= v_now - interval '30 seconds'
    and ((i.last_attempt at time zone 'UTC')::date < (v_now at time zone 'UTC')::date or i.attempts_today < 30);
  if found then return 'claimed'; end if;
  return 'limited';
end;
$$;
revoke all on function public.iq_claim_home_insight_refresh(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.iq_claim_home_insight_refresh(uuid, uuid, uuid) to service_role;

