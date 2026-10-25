# Resolving marketing identity and acquisition gaps

An identity resolution and an acquisition attribution are separate decisions. Confirming a Messenger identity does not establish an ad conversion before the first clinical encounter. Always rerun the normal publication pipeline after a verified source correction and retain unknown or late acquisition evidence explicitly.

## Evidence required

- For a Messenger match, verify the original webhook sender and recipient, a patient-provided phone in an inbound message, and the full canonical patient name in the same conversation within seven days. Require one patient owner across current primary/secondary phones and validated identity keys. Check conflicting CRM patients, contact phones, multiple conversation phone numbers and proxy language. Do not approve phone-only suggestions or infer original direction from an imported timestamp or a projected sender column.
- Multiple CRM contacts for one verified patient can be resolved to a selected contact while retaining the other source records. They are not automatically duplicate contacts to delete.
- An old call-center patient ID may be relinked only through a previously validated, active, non-conflicting legacy-ID bridge corroborated by name and phone. Never use the numeric ID alone: legacy and canonical IDs can overlap between different people.
- Do not convert outbound follow-up into acquisition evidence, move a late source date backwards, infer walk-in from a blank referral field, or infer a referrer's role from a personal name. An ad ID derived from the same phone suggestion is not an independent identity witness.

## Audit and recovery

`mis_internal.marketing_evidence_resolution_audit` stores append-only before/after values and source-event references for operational resolutions. It also records unresolved assessments without changing review decisions. Access is private with forced RLS and no application-role table grants. Keep live case exports and operational SQL under the ignored `docs/database-baseline/private/` directory.

Use a transaction with serialization, appropriate row locks and a worker advisory lock when applying verified changes. Recheck evidence at write time. Preserve original messages, source timestamps, invoices, patient records and manual decisions. Reversals require a new audited correction rather than deleting audit rows. Exported case lists are point-in-time assessments; revalidate current records before acting on them.

Audited legacy call repairs contribute source evidence only while their validated bridge remains valid. Changes to identity-key validation invalidate downstream publication even without a CSV upload. The ordinary processing window and scheduled worker remain in force.

Legacy lifetime refreshes recognize a completed current gateway publication and return `idle_current_publication`. A redundant run still waiting at `clear`, with no derived rows written for that run, is closed as deferred and audited without touching the financial cache. Partially executed runs are never silently discarded. This prevents a late legacy schedule from reopening a current publication just before the processing window closes; schedules and window checks are unchanged.

## Verification

Run the standalone marketing scenarios and full local gateway contract. Confirm audit immutability, missing-audit rejection, bridge-revocation retraction, and source-revision invalidation. After the live worker finishes, require completed marketing, lifetime, contact, ad-outcome and snapshot stages; a matching source/publication revision; balanced invoice totals; zero revenue before source evidence; and zero duplicate positive patient/ad revenue allocations. Check remaining review dispositions separately from financial completeness.
