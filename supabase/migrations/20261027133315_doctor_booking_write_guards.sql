-- Validate all interactive booking paths in the same transaction as their write.
CREATE OR REPLACE FUNCTION public.guard_doctor_booking_slot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_name text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.appointment_date IS NOT DISTINCT FROM OLD.appointment_date AND NEW.appointment_time IS NOT DISTINCT FROM OLD.appointment_time AND NEW.doctor_service IS NOT DISTINCT FROM OLD.doctor_service THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND coalesce(NEW.source_system,'') NOT IN ('app','outgoing_call_queue') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF auth.uid() IS NULL OR NOT coalesce(public.is_active_staff(),false) THEN RAISE EXCEPTION 'Active staff access required.' USING ERRCODE='42501'; END IF;
 v_name:=public.resolve_booking_doctor(NEW.doctor_service);
 IF v_name IS NULL THEN RAISE EXCEPTION 'Select a recognized active doctor before booking.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('doctor_schedules'),hashtext(v_name));
 IF NOT EXISTS(SELECT 1 FROM public.doctor_booking_slots(v_name,NEW.appointment_date) t WHERE t=NEW.appointment_time) THEN
  RAISE EXCEPTION 'This time is outside the current doctor schedule or the doctor is unavailable. Refresh availability and choose another slot.';
 END IF;
 -- Keep legacy service suffixes; the resolver handles them consistently.
 RETURN NEW;
END $$;
CREATE TRIGGER guard_doctor_booking_slot BEFORE INSERT OR UPDATE OF appointment_date,appointment_time,doctor_service ON public.crm_appointments FOR EACH ROW EXECUTE FUNCTION public.guard_doctor_booking_slot();

CREATE OR REPLACE FUNCTION public.validate_doctor_schedule_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_name text;
BEGIN
 v_name:=public.resolve_booking_doctor(NEW.doctor_name);
 IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown active doctor.'; END IF;
 NEW.doctor_name:=v_name;
 PERFORM pg_advisory_xact_lock(hashtext('doctor_schedules'),hashtext(v_name));
 IF EXISTS(SELECT 1 FROM public.doctor_schedules s WHERE s.id<>NEW.id AND public.resolve_booking_doctor(s.doctor_name)=v_name AND s.day_of_week=NEW.day_of_week AND
 (NOT s.is_active OR NOT NEW.is_active OR (s.start_time<NEW.end_time AND NEW.start_time<s.end_time))) THEN RAISE EXCEPTION 'Sessions overlap or mix an OFF day with active sessions.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_doctor_schedule_session BEFORE INSERT OR UPDATE ON public.doctor_schedules FOR EACH ROW EXECUTE FUNCTION public.validate_doctor_schedule_session();

CREATE OR REPLACE FUNCTION public.set_doctor_daily_availability(p_doctor_name text,p_avail_date date,p_is_available boolean,p_start_time time DEFAULT NULL,p_end_time time DEFAULT NULL,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_name text:=public.resolve_booking_doctor(p_doctor_name); v_agent text:=public.current_agent_label(); v_id bigint; v_action text;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.is_active_staff(),false) THEN RAISE EXCEPTION 'Active staff access required.'; END IF;
 IF v_name IS NULL OR p_avail_date IS NULL OR p_is_available IS NULL THEN RAISE EXCEPTION 'Doctor, date and availability are required.'; END IF;
 IF (p_start_time IS NULL)<>(p_end_time IS NULL) OR p_start_time>=p_end_time THEN RAISE EXCEPTION 'Enter both start and end times, with end after start.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('doctor_schedules'),hashtext(v_name));
 IF p_is_available AND NOT EXISTS(SELECT 1 FROM public.doctor_schedules s WHERE public.resolve_booking_doctor(s.doctor_name)=v_name AND s.is_active AND s.day_of_week=extract(dow FROM p_avail_date)) THEN RAISE EXCEPTION 'Configure a weekly session before marking this doctor available.'; END IF;
 DELETE FROM public.doctor_daily_availability WHERE public.resolve_booking_doctor(doctor_name)=v_name AND avail_date=p_avail_date AND doctor_name<>v_name;
 v_action:=CASE WHEN NOT p_is_available THEN 'unavailable' WHEN p_start_time IS NOT NULL THEN 'schedule_change' ELSE 'availability_change' END;
 INSERT INTO public.doctor_daily_availability(doctor_name,avail_date,is_available,start_time,end_time,note,updated_by,updated_at)
 VALUES(v_name,p_avail_date,p_is_available,p_start_time,p_end_time,p_note,v_agent,now())
 ON CONFLICT(doctor_name,avail_date) DO UPDATE SET is_available=excluded.is_available,start_time=excluded.start_time,end_time=excluded.end_time,note=excluded.note,updated_by=excluded.updated_by,updated_at=now() RETURNING id INTO v_id;
 IF p_is_available AND NOT EXISTS(SELECT 1 FROM public.doctor_booking_slots(v_name,p_avail_date)) THEN RAISE EXCEPTION 'These hours leave no full appointment slots. Choose hours within a session or mark unavailable.'; END IF;
 INSERT INTO public.doctor_availability_audit(doctor_name,avail_date,action,is_available,start_time,end_time,note,changed_by) VALUES(v_name,p_avail_date,v_action,p_is_available,p_start_time,p_end_time,p_note,v_agent);
 RETURN jsonb_build_object('id',v_id,'updated_by',v_agent,'action',v_action);
END $$;

CREATE OR REPLACE FUNCTION public.clear_doctor_daily_availability(p_doctor_name text,p_avail_date date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_name text:=public.resolve_booking_doctor(p_doctor_name);
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.is_active_staff(),false) THEN RAISE EXCEPTION 'Active staff access required.'; END IF;
 IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown active doctor.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('doctor_schedules'),hashtext(v_name));
 DELETE FROM public.doctor_daily_availability WHERE public.resolve_booking_doctor(doctor_name)=v_name AND avail_date=p_avail_date;
 INSERT INTO public.doctor_availability_audit(doctor_name,avail_date,action,is_available,changed_by) VALUES(v_name,p_avail_date,'reset_to_normal',true,public.current_agent_label());
END $$;

REVOKE ALL ON FUNCTION public.guard_doctor_booking_slot(),public.validate_doctor_schedule_session() FROM PUBLIC,anon;
