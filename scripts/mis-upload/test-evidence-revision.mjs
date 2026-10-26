import {readFile,readdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
const root=new URL('../../',import.meta.url)
const db=new PGlite()
const tables=['crm_leads','lead_attribution','call_center_logs','referral_patient_report','messenger_contacts','messenger_attribution_touches','meta_message_phone_candidates','meta_call_center_reconciliation','patients','crm_appointments']
const revision=async()=>Number((await db.query('SELECT revision FROM mis_internal.marketing_reconciliation_state')).rows[0].revision)
try {
 await db.exec(`CREATE SCHEMA mis_internal; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE mis_internal.marketing_reconciliation_state(singleton boolean PRIMARY KEY,revision bigint);
 INSERT INTO mis_internal.marketing_reconciliation_state VALUES(true,0);
 CREATE FUNCTION mis_internal.mark_marketing_evidence_dirty() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE mis_internal.marketing_reconciliation_state SET revision=revision+1; RETURN NULL; END$$;`)
 for(const t of tables) await db.exec(`CREATE TABLE public.${t}(id integer PRIMARY KEY,evidence text,updated_at timestamptz,updated_by text); CREATE TRIGGER mis_marketing_evidence_dirty AFTER INSERT OR UPDATE OR DELETE ON public.${t} FOR EACH STATEMENT EXECUTE FUNCTION mis_internal.mark_marketing_evidence_dirty();`)
 const file=(await readdir(new URL('supabase/migrations/',root))).find(f=>f.endsWith('_ignore_unchanged_marketing_evidence.sql'))
 await db.exec(await readFile(new URL('supabase/migrations/'+file,root),'utf8'))
 for(const t of tables) {
  const before=await revision()
  await db.exec(`INSERT INTO public.${t} SELECT n,'original',now(),'test' FROM generate_series(1,3)n;`)
  assert.equal(await revision(),before+1,'one revision for a bulk insert')
  await db.exec(`UPDATE public.${t} SET evidence=evidence,updated_at=clock_timestamp(),updated_by='clock-only'; UPDATE public.${t} SET evidence='none' WHERE false; DELETE FROM public.${t} WHERE false; INSERT INTO public.${t} SELECT 9,'empty',now(),null WHERE false;`)
  assert.equal(await revision(),before+1,'empty and bookkeeping writes do not invalidate')
  await db.exec(`UPDATE public.${t} SET evidence='changed' WHERE id=1`)
  assert.equal(await revision(),before+2,'real source change invalidates')
  await db.exec(`BEGIN; UPDATE public.${t} SET evidence='rollback'; ROLLBACK;`)
  assert.equal(await revision(),before+2,'rollback preserves revision')
  await db.exec(`DELETE FROM public.${t} WHERE id=1`)
  assert.equal(await revision(),before+3,'real deletion invalidates')
 }
 console.log('Evidence revisions passed for all ten source tables: bulk changes, no-ops, timestamps, empty writes and rollback.')
} finally {await db.close()}
