create table public.iq_named_clinicians (
 practice_id uuid not null references public.iq_practices(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 300),
 user_type text not null check (length(btrim(user_type)) between 1 and 300),
 locum text not null default 'unknown' check (locum in ('unknown','yes','no')),
 primary key (practice_id,name,user_type)
);
alter table public.iq_named_clinicians enable row level security;
revoke all on public.iq_named_clinicians from public,anon,authenticated;
grant select,insert,update on public.iq_named_clinicians to authenticated;
create policy named_clinicians_admin_select on public.iq_named_clinicians for select to authenticated using (iq_private.iq_can_access(practice_id,true));
create policy named_clinicians_admin_insert on public.iq_named_clinicians for insert to authenticated with check (iq_private.iq_can_access(practice_id,true));
create policy named_clinicians_admin_update on public.iq_named_clinicians for update to authenticated using (iq_private.iq_can_access(practice_id,true)) with check (iq_private.iq_can_access(practice_id,true));
