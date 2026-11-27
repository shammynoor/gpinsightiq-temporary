drop view public.iq_individual_locum_tokens;
create function iq_private.iq_individual_locum_tokens(p_practice uuid) returns table(person_token text)
language plpgsql stable security definer set search_path='' as $fn$
begin
 if not iq_private.iq_can_access(p_practice,false) then raise exception 'Practice access required' using errcode='42501'; end if;
 return query select distinct 'h1:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('["gp-insight-session-holder-v1","'||p_practice::text||'",'||pg_catalog.to_json(pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(normalize(n.name,NFKC),'\s+',' ','g'))))::text||']','UTF8')),'hex') from public.iq_named_clinicians n where n.practice_id=p_practice and n.locum='yes';
end $fn$;
revoke all on function iq_private.iq_individual_locum_tokens(uuid) from public,anon,authenticated;
grant execute on function iq_private.iq_individual_locum_tokens(uuid) to authenticated;
create function public.iq_individual_locum_tokens(p_practice uuid) returns table(person_token text)
language sql stable security invoker set search_path='' as $fn$ select * from iq_private.iq_individual_locum_tokens(p_practice) $fn$;
revoke all on function public.iq_individual_locum_tokens(uuid) from public,anon,authenticated;
grant execute on function public.iq_individual_locum_tokens(uuid) to authenticated;
