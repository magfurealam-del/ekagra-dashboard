-- Booking identity is separate from billing identity: preserve historical foreign keys.
ALTER TABLE public.doctor_schedules ALTER COLUMN slot_minutes SET NOT NULL, ALTER COLUMN is_active SET NOT NULL;
ALTER TABLE public.doctor_schedules ADD CONSTRAINT doctor_session_has_full_slot CHECK(extract(epoch FROM (end_time-start_time))/60>=slot_minutes);
CREATE OR REPLACE FUNCTION public.booking_doctor_key(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT regexp_replace(lower(split_part(replace(coalesce(p_name,''),'–','—'),'—',1)),'[^a-z0-9]','','g')
$$;
CREATE TABLE public.doctor_booking_aliases (
 alias_key text PRIMARY KEY, canonical_doctor_id integer NOT NULL REFERENCES public.doctors(id),
 evidence text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.doctor_booking_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read_booking_aliases ON public.doctor_booking_aliases FOR SELECT TO authenticated USING(public.is_active_staff());
GRANT SELECT ON public.doctor_booking_aliases TO authenticated;
-- Four semantic pairs confirmed by the owner; remaining differences are punctuation only.
INSERT INTO public.doctor_booking_aliases(alias_key,canonical_doctor_id,evidence)
SELECT public.booking_doctor_key(v.alias),d.id,v.evidence FROM (VALUES
 ('Dr. Md. Abdul Bari Khandakar','Dr. Md. Bari Khandakar','Owner confirmed 2026-10-27'),
 ('Dr. MD. Ejaj Bari Choudhury','Dr. Ejaj Bari Choudhury','Owner confirmed 2026-10-27'),
 ('Dr. As-Ad Din Mahmood','Dr. As-Ad Din Mahmood Asad','Owner confirmed 2026-10-27'),
 ('Dr. Hasan Khalid Md. Munir','Dr. Hasan Khalid MD. Monir','Owner confirmed 2026-10-27'),
 ('Dr. Muhammad Nazmul Hassan,','Dr. Muhammad Nazmul Hassan','Punctuation-only duplicate'),
 ('Dr Rakibul Hasan Apu','Dr. Rakibul Hasan Apu','Punctuation-only duplicate')
) v(alias,canonical,evidence) JOIN public.doctors d ON d.name=v.canonical;

CREATE OR REPLACE FUNCTION public.resolve_booking_doctor(p_name text) RETURNS text
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT d.name FROM public.doctors d WHERE d.is_active AND d.id=coalesce(
   (SELECT canonical_doctor_id FROM public.doctor_booking_aliases WHERE alias_key=public.booking_doctor_key(p_name)),
   (SELECT x.id FROM public.doctors x WHERE public.booking_doctor_key(x.name)=public.booking_doctor_key(p_name)
    ORDER BY x.is_active DESC,EXISTS(SELECT 1 FROM public.doctor_schedules s WHERE s.doctor_name=x.name) DESC,x.id LIMIT 1))
$$;

CREATE OR REPLACE FUNCTION public.get_doctor_booking_directory() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.is_active_staff(),false) THEN RAISE EXCEPTION 'Active staff access required.' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY name),'[]') FROM (
 SELECT d.name, array_agg(DISTINCT a.name) aliases,
 EXISTS(SELECT 1 FROM public.doctor_schedules s WHERE public.resolve_booking_doctor(s.doctor_name)=d.name AND s.is_active) has_schedule,
 EXISTS(SELECT 1 FROM public.doctor_schedules s WHERE public.resolve_booking_doctor(s.doctor_name)=d.name) has_configured_schedule
 FROM public.doctors d JOIN public.doctors a ON public.resolve_booking_doctor(a.name)=d.name
 WHERE d.is_active AND public.resolve_booking_doctor(d.name)=d.name GROUP BY d.id,d.name)x);
END $$;

CREATE OR REPLACE FUNCTION public.doctor_booking_slots(p_doctor_name text,p_date date) RETURNS SETOF text
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 WITH doctor AS (SELECT public.resolve_booking_doctor(p_doctor_name) name),
 override AS (SELECT coalesce(bool_and(o.is_available),true) available,max(o.start_time) start_time,min(o.end_time) end_time
 FROM public.doctor_daily_availability o,doctor d WHERE public.resolve_booking_doctor(o.doctor_name)=d.name AND o.avail_date=p_date)
 SELECT DISTINCT to_char(p_date + s.start_time + (n * s.slot_minutes)*interval '1 minute','HH24:MI') slot
 FROM public.doctor_schedules s CROSS JOIN doctor d CROSS JOIN override o
 CROSS JOIN LATERAL generate_series(0,floor(extract(epoch FROM (s.end_time-s.start_time))/60/s.slot_minutes)::int-1) n
 WHERE s.is_active AND s.slot_minutes BETWEEN 5 AND 120 AND s.doctor_name=d.name
 AND s.day_of_week=extract(dow FROM p_date) AND o.available
 AND s.start_time+n*s.slot_minutes*interval '1 minute'>=coalesce(o.start_time,s.start_time)
 AND s.start_time+(n+1)*s.slot_minutes*interval '1 minute'<=least(s.end_time,coalesce(o.end_time,s.end_time)) ORDER BY slot
$$;

CREATE OR REPLACE FUNCTION public.get_doctor_booking_context(p_doctor_name text,p_start_date date,p_end_date date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_name text; v_end date:=coalesce(p_end_date,p_start_date); v_status text;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.is_active_staff(),false) THEN RAISE EXCEPTION 'Active staff access required.' USING ERRCODE='42501'; END IF;
 IF p_start_date IS NULL OR v_end<p_start_date OR v_end-p_start_date>62 THEN RAISE EXCEPTION 'Choose a date range of at most 63 days.'; END IF;
 v_name:=public.resolve_booking_doctor(p_doctor_name);
 v_status:=CASE WHEN v_name IS NULL THEN 'unknown_doctor'
 WHEN NOT EXISTS(SELECT 1 FROM public.doctor_schedules WHERE public.resolve_booking_doctor(doctor_name)=v_name) THEN 'schedule_missing'
 WHEN NOT EXISTS(SELECT 1 FROM public.doctor_schedules WHERE public.resolve_booking_doctor(doctor_name)=v_name AND is_active) THEN 'schedule_paused' ELSE 'ready' END;
 RETURN jsonb_build_object('doctor_name',v_name,'status',v_status,'days',(
 SELECT jsonb_agg(jsonb_build_object('date',d::date,'slots',(SELECT coalesce(jsonb_agg(slot),'[]') FROM public.doctor_booking_slots(v_name,d::date) slot),
 'appointment_count',(SELECT count(*) FROM public.crm_appointments a WHERE a.appointment_date=d::date AND public.resolve_booking_doctor(a.doctor_service)=v_name AND lower(coalesce(a.appointment_status,'')) NOT IN ('cancelled','canceled','rescheduled')),
 'unavailable',EXISTS(SELECT 1 FROM public.doctor_daily_availability o WHERE public.resolve_booking_doctor(o.doctor_name)=v_name AND avail_date=d::date AND NOT is_available)))
 FROM generate_series(p_start_date::timestamp,v_end::timestamp,interval '1 day') d));
END $$;

REVOKE ALL ON FUNCTION public.booking_doctor_key(text),public.resolve_booking_doctor(text),public.doctor_booking_slots(text,date),public.get_doctor_booking_directory(),public.get_doctor_booking_context(text,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.booking_doctor_key(text),public.resolve_booking_doctor(text),public.doctor_booking_slots(text,date),public.get_doctor_booking_directory(),public.get_doctor_booking_context(text,date,date) TO authenticated;
