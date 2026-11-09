create table public.iq_chart_preferences (
  practice_id uuid not null references public.iq_practices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  preference_key text not null check (length(preference_key) between 1 and 512),
  value jsonb not null check (octet_length(value::text) <= 65536),
  primary key (practice_id, user_id, preference_key)
);
alter table public.iq_chart_preferences enable row level security;
revoke all on public.iq_chart_preferences from public, anon, authenticated;
grant select, insert, update on public.iq_chart_preferences to authenticated;
create policy iq_chart_preferences_own on public.iq_chart_preferences
  for all to authenticated
  using (user_id = (select auth.uid()) and iq_private.iq_can_access(practice_id))
  with check (user_id = (select auth.uid()) and iq_private.iq_can_access(practice_id));
