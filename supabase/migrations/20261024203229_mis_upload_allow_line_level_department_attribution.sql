-- Department and contributor-doctor attribution may differ per invoice line.
-- Invoice identity, patient, date, admission, and all other header fields stay consistent.
CREATE OR REPLACE FUNCTION mis_internal.enqueue_mis_upload(p_actor_id uuid,p_upload_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE p mis_internal.mis_upload_parses%rowtype; b bigint; n integer;
BEGIN
 PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
 -- Share the acceptance/publication barrier so a finalizer cannot publish over a new upload.
 PERFORM pg_advisory_xact_lock(806731,7100);
 SELECT x.* INTO p FROM mis_internal.mis_upload_state s
 JOIN mis_internal.mis_upload_parses x ON x.id=s.active_parse_id
 WHERE s.upload_id=p_upload_id AND x.status='sealed' FOR UPDATE OF s;
 IF NOT FOUND OR p.source_row_count=0 THEN RAISE EXCEPTION 'sealed nonempty parse required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM mis_internal.mis_upload_rows WHERE parse_id=p.id AND disposition<>'parsed')
 OR EXISTS(SELECT 1 FROM mis_internal.mis_import_validations WHERE parse_id=p.id AND outcome IN ('rejected','conflict'))
 THEN RAISE EXCEPTION 'validation findings must be corrected in a new source file' USING ERRCODE='22023'; END IF;
 -- A whole invoice must agree on identity, dates, admission and header fields.
 IF EXISTS(SELECT 1 FROM mis_internal.mis_upload_rows r WHERE parse_id=p.id
   GROUP BY lower(btrim(normalized_values->>'invoice_id')) HAVING
   count(*)>1000 OR count(DISTINCT (normalized_values-ARRAY[
     'item_id','item_name','sales_amount','item_discount','net_sales','net_collection',
     'cancellation_amount','parent_item_type_name','item_type_name','business_unit_name',
     'doctors_department','contributor_doctor_name']))<>1)
 THEN RAISE EXCEPTION 'invoice has conflicting headers or exceeds 1000 lines' USING ERRCODE='22023'; END IF;
 INSERT INTO mis_internal.mis_gateway_batches(parse_id,actor_id) VALUES(p.id,p_actor_id)
 ON CONFLICT(parse_id) DO NOTHING RETURNING id INTO b;
 IF b IS NULL THEN SELECT id INTO b FROM mis_internal.mis_gateway_batches WHERE parse_id=p.id; END IF;
 INSERT INTO mis_internal.mis_gateway_jobs(batch_id,invoice_key)
 SELECT b,lower(btrim(normalized_values->>'invoice_id')) FROM mis_internal.mis_upload_rows
 WHERE parse_id=p.id GROUP BY 2 ON CONFLICT(batch_id,invoice_key) DO NOTHING;
 SELECT count(*) INTO n FROM mis_internal.mis_gateway_jobs WHERE batch_id=b;
 RETURN jsonb_build_object('batchId',b,'invoiceCount',n,'state','queued');
END $f$;
