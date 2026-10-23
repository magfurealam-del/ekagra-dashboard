-- Private evidence storage for MIS gateway implementation.
-- This migration creates no bucket, source-table trigger, worker, or schedule.

CREATE SCHEMA IF NOT EXISTS mis_internal;
-- Preserve any pre-existing service-role schema access; the new private
-- tables receive no service-role table grants in this migration.
REVOKE ALL ON SCHEMA mis_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE, CREATE ON SCHEMA mis_internal TO postgres;
-- The schema must remain absent from PostgREST's exposed-schema list. The
-- authenticated grant is only for the public invoker RPC to call its private
-- SECURITY DEFINER implementation; it grants no table access.
GRANT USAGE ON SCHEMA mis_internal TO authenticated;
GRANT EXECUTE ON FUNCTION mis_internal.complete_password_change() TO authenticated;

CREATE TABLE mis_internal.mis_upload_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_namespace text NOT NULL DEFAULT 'ekagra_mis',
  source_file_sha256 text NOT NULL
    CHECK (source_file_sha256 ~ '^[0-9a-f]{64}$'),
  storage_object_key text NOT NULL UNIQUE,
  original_file_name text NOT NULL,
  byte_count bigint NOT NULL CHECK (byte_count > 0),
  declared_media_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  received_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mis_upload_files_namespace_sha256_key
    UNIQUE (source_namespace, source_file_sha256),
  CONSTRAINT mis_upload_files_namespace_check
    CHECK (source_namespace = lower(btrim(source_namespace)) AND source_namespace <> ''),
  CONSTRAINT mis_upload_files_name_check
    CHECK (btrim(original_file_name) <> '' AND length(original_file_name) <= 255),
  CONSTRAINT mis_upload_files_media_type_check
    CHECK (length(declared_media_type) BETWEEN 1 AND 127)
);

CREATE TABLE mis_internal.mis_upload_state (
  upload_id uuid PRIMARY KEY REFERENCES mis_internal.mis_upload_files(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'uploaded'
    CHECK (state IN ('uploaded', 'parsing', 'validated', 'staged', 'failed', 'quarantined')),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  active_parse_id uuid,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE mis_internal.mis_upload_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid REFERENCES mis_internal.mis_upload_files(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  request_idempotency_key uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mis_upload_attempts_actor_request_key UNIQUE (actor_id, request_idempotency_key)
);

CREATE TABLE mis_internal.mis_upload_attempt_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES mis_internal.mis_upload_attempts(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'reserved', 'duplicate', 'rejected', 'uploaded', 'parse_failed', 'staged'
  )),
  error_code text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE mis_internal.mis_upload_parses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES mis_internal.mis_upload_files(id) ON DELETE RESTRICT,
  parser_name text NOT NULL,
  parser_version text NOT NULL,
  schema_version text NOT NULL,
  normalization_version text NOT NULL,
  reference_year integer NOT NULL CHECK (reference_year BETWEEN 1890 AND 2200),
  source_row_count integer NOT NULL CHECK (source_row_count >= 0),
  blank_record_count integer NOT NULL DEFAULT 0 CHECK (blank_record_count >= 0),
  header_sha256 text NOT NULL CHECK (header_sha256 ~ '^[0-9a-f]{64}$'),
  rowset_sha256 text NOT NULL CHECK (rowset_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('parsing', 'sealed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sealed_at timestamptz,
  CONSTRAINT mis_upload_parses_seal_check CHECK (
    (status = 'sealed' AND sealed_at IS NOT NULL)
    OR (status <> 'sealed' AND sealed_at IS NULL)
  ),
  CONSTRAINT mis_upload_parses_upload_parser_key UNIQUE (
    upload_id, parser_name, parser_version, schema_version, normalization_version
  )
);

ALTER TABLE mis_internal.mis_upload_state
  ADD CONSTRAINT mis_upload_state_active_parse_fkey
  FOREIGN KEY (active_parse_id) REFERENCES mis_internal.mis_upload_parses(id)
  ON DELETE RESTRICT;

CREATE TABLE mis_internal.mis_upload_rows (
  parse_id uuid NOT NULL REFERENCES mis_internal.mis_upload_parses(id) ON DELETE RESTRICT,
  source_row_number integer NOT NULL CHECK (source_row_number > 0),
  raw_cells jsonb NOT NULL CHECK (jsonb_typeof(raw_cells) = 'array'),
  normalized_values jsonb NOT NULL CHECK (jsonb_typeof(normalized_values) = 'object'),
  row_sha256 text NOT NULL CHECK (row_sha256 ~ '^[0-9a-f]{64}$'),
  disposition text NOT NULL DEFAULT 'parsed'
    CHECK (disposition IN ('parsed', 'structural_blank', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (parse_id, source_row_number)
);

CREATE TABLE mis_internal.mis_import_validations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  upload_id uuid NOT NULL REFERENCES mis_internal.mis_upload_files(id) ON DELETE RESTRICT,
  parse_id uuid REFERENCES mis_internal.mis_upload_parses(id) ON DELETE RESTRICT,
  source_row_number integer,
  check_code text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('passed', 'warning', 'rejected', 'conflict')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object'),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mis_import_validation_row_check CHECK (
    source_row_number IS NULL OR source_row_number > 0
  )
);

CREATE INDEX mis_upload_attempts_upload_started_idx
  ON mis_internal.mis_upload_attempts (upload_id, started_at DESC);
CREATE INDEX mis_upload_attempt_events_attempt_idx
  ON mis_internal.mis_upload_attempt_events (attempt_id, id);
CREATE INDEX mis_upload_parses_upload_created_idx
  ON mis_internal.mis_upload_parses (upload_id, created_at DESC);
CREATE INDEX mis_upload_rows_row_digest_idx
  ON mis_internal.mis_upload_rows (row_sha256);
CREATE INDEX mis_import_validations_upload_checked_idx
  ON mis_internal.mis_import_validations (upload_id, checked_at DESC);

CREATE OR REPLACE FUNCTION mis_internal.reject_mis_upload_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'MIS upload history is append-only'
    USING ERRCODE = '55000';
END;
$function$;

REVOKE ALL ON FUNCTION mis_internal.reject_mis_upload_history_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER mis_upload_files_append_only
  BEFORE UPDATE OR DELETE ON mis_internal.mis_upload_files
  FOR EACH ROW EXECUTE FUNCTION mis_internal.reject_mis_upload_history_mutation();
CREATE TRIGGER mis_upload_attempts_append_only
  BEFORE UPDATE OR DELETE ON mis_internal.mis_upload_attempts
  FOR EACH ROW EXECUTE FUNCTION mis_internal.reject_mis_upload_history_mutation();
CREATE TRIGGER mis_upload_attempt_events_append_only
  BEFORE UPDATE OR DELETE ON mis_internal.mis_upload_attempt_events
  FOR EACH ROW EXECUTE FUNCTION mis_internal.reject_mis_upload_history_mutation();
CREATE TRIGGER mis_upload_rows_append_only
  BEFORE UPDATE OR DELETE ON mis_internal.mis_upload_rows
  FOR EACH ROW EXECUTE FUNCTION mis_internal.reject_mis_upload_history_mutation();
CREATE TRIGGER mis_import_validations_append_only
  BEFORE UPDATE OR DELETE ON mis_internal.mis_import_validations
  FOR EACH ROW EXECUTE FUNCTION mis_internal.reject_mis_upload_history_mutation();

CREATE OR REPLACE FUNCTION mis_internal.guard_mis_upload_row_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM mis_internal.mis_upload_parses p
     WHERE p.id = NEW.parse_id
       AND p.status = 'parsing'
       AND p.sealed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'MIS rows can only be appended to an unsealed parse'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION mis_internal.guard_mis_upload_row_insert()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER mis_upload_rows_unsealed_parse_only
  BEFORE INSERT ON mis_internal.mis_upload_rows
  FOR EACH ROW EXECUTE FUNCTION mis_internal.guard_mis_upload_row_insert();

CREATE OR REPLACE FUNCTION mis_internal.reject_sealed_parse_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'sealed' THEN
    RAISE EXCEPTION 'sealed MIS parse metadata is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION mis_internal.reject_sealed_parse_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER mis_upload_parses_seal_guard
  BEFORE UPDATE OR DELETE ON mis_internal.mis_upload_parses
  FOR EACH ROW EXECUTE FUNCTION mis_internal.reject_sealed_parse_mutation();

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'mis_upload_files', 'mis_upload_state', 'mis_upload_attempts',
    'mis_upload_attempt_events',
    'mis_upload_parses', 'mis_upload_rows', 'mis_import_validations'
  ] LOOP
    EXECUTE format('ALTER TABLE mis_internal.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE mis_internal.%I FORCE ROW LEVEL SECURITY', v_table);
  END LOOP;
END;
$rls$;

-- No browser or service-role table grants are made. Future access must use
-- narrow authenticated server functions after the upload contract is approved.
