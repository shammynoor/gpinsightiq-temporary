-- Application revision conflicts are permanent for a given expected revision.
-- 40001 tells PostgREST 14 to retry the transaction indefinitely. Use P0001
-- instead; retain the existing access checks, locking and optimistic concurrency.
CREATE OR REPLACE FUNCTION iq_private.iq_save_analytics_settings(p_practice uuid, p_settings jsonb, p_expected bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare current_revision bigint; next_revision bigint;
begin
 if not iq_private.iq_can_access(p_practice,true) then raise exception 'Practice administrator required' using errcode='42501';end if;
 if jsonb_typeof(p_settings) is distinct from 'object' or octet_length(p_settings::text)>2000000 then raise exception 'Invalid practice settings';end if;
 perform 1 from public.iq_practices where id=p_practice for update;
 select revision into current_revision from public.iq_analytics_settings where practice_id=p_practice;
 if coalesce(current_revision,0) is distinct from p_expected then raise exception 'Settings changed in another session. Reload before editing.' using errcode='P0001';end if;
 next_revision:=coalesce(current_revision,0)+1;
 insert into public.iq_analytics_settings(practice_id,settings,updated_by,revision) values(p_practice,p_settings,auth.uid(),next_revision)
 on conflict(practice_id) do update set settings=excluded.settings,updated_by=excluded.updated_by,revision=excluded.revision,updated_at=now();
 return next_revision;
end $function$;

CREATE OR REPLACE FUNCTION iq_private.iq_save_analytics_source(p_practice uuid, p_key text, p_kind text, p_name text, p_clinical timestamp with time zone, p_count integer, p_payload text, p_expected bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare current_revision bigint; next_revision bigint;
begin
 if not iq_private.iq_can_access(p_practice,true) then raise exception 'Practice administrator required' using errcode='42501';end if;
 perform 1 from public.iq_practices where id=p_practice for update;
 select revision into current_revision from public.iq_analytics_sources where practice_id=p_practice and source_key=p_key;
 if coalesce(current_revision,0) is distinct from p_expected then raise exception 'Report changed. Refresh before uploading again.' using errcode='P0001';end if;
 if p_payload !~ '^[A-Za-z0-9+/]+={0,2}$' then raise exception 'Invalid compressed report';end if;
 if p_clinical is null or p_clinical>'2100-01-01' or p_clinical<'2000-01-01' then raise exception 'Invalid report date';end if;
 next_revision:=coalesce(current_revision,0)+1;
 insert into public.iq_analytics_sources(practice_id,source_key,kind,source_name,clinical_at,row_count,payload,imported_by,revision)
 values(p_practice,p_key,p_kind,trim(p_name),p_clinical,p_count,p_payload,auth.uid(),next_revision)
 on conflict(practice_id,source_key) do update set kind=excluded.kind,source_name=excluded.source_name,clinical_at=excluded.clinical_at,row_count=excluded.row_count,payload=excluded.payload,imported_by=excluded.imported_by,revision=excluded.revision,imported_at=now();
 insert into public.iq_audit(practice_id,actor,action) values(p_practice,auth.uid(),'analytics_report_saved');
 return next_revision;
end $function$;

CREATE OR REPLACE FUNCTION iq_private.iq_delete_analytics_source(p_practice uuid, p_key text, p_expected bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 if not iq_private.iq_can_access(p_practice,true) then raise exception 'Practice administrator required' using errcode='42501';end if;
 delete from public.iq_analytics_sources where practice_id=p_practice and source_key=p_key and revision=p_expected;
 if not found then raise exception 'Report changed. Refresh before removing it.' using errcode='P0001';end if;
 insert into public.iq_audit(practice_id,actor,action) values(p_practice,auth.uid(),'analytics_report_removed');
end $function$;
