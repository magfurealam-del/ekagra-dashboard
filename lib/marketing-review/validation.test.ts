import test from 'node:test'
import assert from 'node:assert/strict'
import { positiveId, validateCorrection } from './validation.ts'
import { isPooledIdentity } from './types.ts'
const valid = { action:'verify_source', reason:'Verified original registration record.', evidenceReference:'Registration #12345', verifiedHn:'H1', attested:true, source:'facebook', eventDate:'2026-05-01', excludedEvidence:[] }
test('requires independent verification details for an acquisition correction', () => {
  assert.equal(validateCorrection('revenue',valid),null)
  for (const bad of [{attested:false},{verifiedHn:''},{evidenceReference:''},{source:''},{source:'made up'},{eventDate:'2026-02-30'},{reason:'short'}]) assert.ok(validateCorrection('revenue',{...valid,...bad}))
})
test('bounds identities and evidence without coercing unsafe IDs', () => {
  for (const id of ['1 OR true',0,-1,1.1,Number.MAX_SAFE_INTEGER+1,{},null]) assert.equal(positiveId(id),null)
  assert.equal(positiveId('12'),12)
  assert.ok(validateCorrection('revenue',{...valid,excludedEvidence:new Array(21).fill({table:'crm_leads',id:'1'})}))
})
test('identity decisions require a selected versioned CRM lead', () => {
  assert.ok(validateCorrection('meta',{...valid,action:'confirm'}))
  assert.equal(validateCorrection('meta',{...valid,action:'confirm',leadId:12,leadVersion:'a'.repeat(32)}),null)
  assert.equal(validateCorrection('meta',{action:'needs_review',reason:'No independent evidence available yet.'}),null)
})
test('pooled billing identities cannot be treated as one person', () => {
  assert.equal(isPooledIdentity('GC','Any label'),true)
  assert.equal(isPooledIdentity('Other','MR. GENERAL CUSTOMER'),true)
  assert.equal(isPooledIdentity('H123','Synthetic Person'),false)
})
