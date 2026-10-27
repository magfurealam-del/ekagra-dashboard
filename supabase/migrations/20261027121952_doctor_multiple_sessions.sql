-- One row per session, with atomic doctor/day replacement through the admin RPC.
ALTER TABLE public.doctor_schedules DROP CONSTRAINT doctor_schedules_doctor_day_unique;
ALTER TABLE public.doctor_schedules ADD CONSTRAINT doctor_schedules_session_unique UNIQUE(doctor_name,day_of_week,start_time);
ALTER TABLE public.doctor_schedules ADD CONSTRAINT doctor_schedules_valid_hours CHECK(start_time < end_time);
ALTER TABLE public.doctor_schedules ADD CONSTRAINT doctor_schedules_valid_slot CHECK(slot_minutes BETWEEN 5 AND 120);

CREATE OR REPLACE FUNCTION public.bulk_upsert_doctor_schedules(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; v_rows jsonb:='[]'; v_name text; d record; v_before jsonb; v_count integer;
BEGIN
 IF NOT coalesce(public.is_admin(),false) THEN RAISE EXCEPTION 'Only admins can update doctor schedules.'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)=0 OR jsonb_array_length(p_rows)>2000 THEN
  RAISE EXCEPTION 'Provide 1–2000 schedule sessions.';
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  SELECT name INTO v_name FROM public.doctors doc
   WHERE is_active AND lower(regexp_replace(name,'[.[:space:]]','','g'))=lower(regexp_replace(r->>'doctor_name','[.[:space:]]','','g'))
   ORDER BY EXISTS(SELECT 1 FROM public.doctor_schedules s WHERE s.doctor_name=doc.name) DESC, (name LIKE 'Dr.%') DESC, name LIMIT 1;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown active doctor: %', r->>'doctor_name'; END IF;
  IF (r->>'day_of_week') IS NULL OR (r->>'day_of_week')::int NOT BETWEEN 0 AND 6
    OR coalesce(r->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
    OR coalesce(r->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
    OR (r->>'start_time')::time >= (r->>'end_time')::time
    OR coalesce((r->>'slot_minutes')::int,15) NOT BETWEEN 5 AND 120 THEN RAISE EXCEPTION 'Invalid schedule range for %',v_name; END IF;
  v_rows:=v_rows||jsonb_build_array(r||jsonb_build_object('doctor_name',v_name,'day_of_week',(r->>'day_of_week')::int,'slot_minutes',coalesce((r->>'slot_minutes')::int,15),'is_active',coalesce((r->>'is_active')::boolean,true)));
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) WITH ORDINALITY a(r,n)
  JOIN jsonb_array_elements(v_rows) WITH ORDINALITY b(r,n) ON a.n<b.n
  WHERE a.r->>'doctor_name'=b.r->>'doctor_name' AND a.r->>'day_of_week'=b.r->>'day_of_week'
   AND (NOT (a.r->>'is_active')::boolean OR NOT (b.r->>'is_active')::boolean
     OR ((a.r->>'start_time')::time<(b.r->>'end_time')::time AND (b.r->>'start_time')::time<(a.r->>'end_time')::time))) THEN
  RAISE EXCEPTION 'Sessions overlap or mix an OFF day with active sessions.';
 END IF;
 -- Serialize changes per doctor. Replacements and the before/after audit are one transaction.
 FOR d IN SELECT DISTINCT x->>'doctor_name' name FROM jsonb_array_elements(v_rows) x ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtext('doctor_schedules'),hashtext(d.name));
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') INTO v_before FROM public.doctor_schedules s
 WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) x WHERE x->>'doctor_name'=s.doctor_name AND (x->>'day_of_week')::int=s.day_of_week);
 DELETE FROM public.doctor_schedules s WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) x WHERE x->>'doctor_name'=s.doctor_name AND (x->>'day_of_week')::int=s.day_of_week);
 INSERT INTO public.doctor_schedules(doctor_name,day_of_week,start_time,end_time,slot_minutes,is_active)
 SELECT x->>'doctor_name',(x->>'day_of_week')::smallint,(x->>'start_time')::time,(x->>'end_time')::time,(x->>'slot_minutes')::smallint,(x->>'is_active')::boolean FROM jsonb_array_elements(v_rows)x;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 INSERT INTO public.sync_audit_log(source_system,table_name,operation,internal_id,status,payload)
 VALUES('app','doctor_schedules','bulk_upsert','schedule_editor','ok',jsonb_build_object('before',v_before,'after',v_rows,'changed_by',public.current_agent_label()));
 RETURN jsonb_build_object('rows_upserted',v_count);
END; $$;
REVOKE ALL ON FUNCTION public.bulk_upsert_doctor_schedules(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_doctor_schedules(jsonb) TO authenticated;
