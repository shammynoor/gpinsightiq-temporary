create view public.iq_individual_locum_tokens with (security_barrier=true) as
select distinct practice_id, 'h1:'||encode(sha256(convert_to('["gp-insight-session-holder-v1","'||practice_id::text||'",'||to_json(lower(trim(regexp_replace(normalize(name,NFKC),'\s+',' ','g'))))::text||']','UTF8')),'hex') as person_token
from public.iq_named_clinicians where locum='yes' and iq_private.iq_can_access(practice_id,false);
revoke all on public.iq_individual_locum_tokens from public,anon,authenticated;
grant select on public.iq_individual_locum_tokens to authenticated;
