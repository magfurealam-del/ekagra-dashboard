CREATE OR REPLACE FUNCTION public.bulk_upsert_doctor_schedules(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; v_rows jsonb:='[]'; v_name text; d record; v_before jsonb; v_count integer;
BEGIN
 IF NOT coalesce(public.is_admin(),false) THEN RAISE EXCEPTION 'Only admins can update doctor schedules.'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)=0 OR jsonb_array_length(p_rows)>2000 THEN
  RAISE EXCEPTION 'Provide 1–2000 schedule sessions.';
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  v_name:=public.resolve_booking_doctor(r->>'doctor_name');
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

CREATE OR REPLACE FUNCTION public.reschedule_appointment(old_appointment_id bigint, new_date date, new_time text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_id bigint;
  old_row public.crm_appointments;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_staff() THEN
    RAISE EXCEPTION 'active staff authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO old_row FROM public.crm_appointments WHERE id = old_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment % not found', old_appointment_id; END IF;
  IF lower(coalesce(old_row.appointment_status,'')) IN ('rescheduled','cancelled','canceled') THEN RAISE EXCEPTION 'Appointment is already rescheduled or cancelled. Refresh the calendar.'; END IF;

  UPDATE public.crm_appointments
  SET appointment_status = 'Rescheduled', updated_at = now()
  WHERE id = old_appointment_id;

  INSERT INTO public.crm_appointments (
    patient_id, lead_id, appointment_date, appointment_time, doctor_service, doctor_id,
    appointment_type, appointment_status, confirmation_status, no_show_risk, notes,
    previous_appointment_id, source_system
  )
  VALUES (
    old_row.patient_id, old_row.lead_id, new_date, new_time, old_row.doctor_service, old_row.doctor_id,
    old_row.appointment_type, 'Booked', 'Not Confirmed', old_row.no_show_risk, old_row.notes,
    old_appointment_id, 'app'
  )
  RETURNING id INTO new_id;

  UPDATE public.crm_appointments
  SET rescheduled_to_appointment_id = new_id
  WHERE id = old_appointment_id;

  INSERT INTO public.sync_audit_log(source_system, table_name, operation, internal_id, status, payload)
  VALUES ('app','crm_appointments','reschedule', new_id::text, 'ok',
    jsonb_build_object('old_id', old_appointment_id));

  RETURN new_id;
END;
$function$
