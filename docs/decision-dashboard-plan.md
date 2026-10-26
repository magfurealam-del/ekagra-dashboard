# Decision dashboard implementation plan

## Product and interaction

The executive reads a short briefing, then chooses a question: team workload, acquisition effectiveness, follow-up priorities, billed revenue or confidence in evidence. Preserve the eight-section navigation and clinic-date reporting controls. Use two or three primary panels per section, selected detail instead of repeated cards, and concise definitions beside every comparison.

Use the existing shadcn/Geist/teal design system. White panels on a quiet slate canvas, 24px spacing, tabular values, fixed 0–100 scales for rates, chronological axes, consistent category colors. Every chart has exact values or an accessible table. Mobile panels stack without page overflow; controls remain labeled and keyboard accessible. Empty, unavailable and zero are separate states.

| Section | Primary content | Retired from primary view |
|---|---|---|
| Overview | Four outcome cards; activity trend; revenue/verified-visit trend selector; action priorities and source summary | Repeated gauges and expanded outcome detail |
| Team | Stacked workload by purpose; channel-specific rate comparison with denominators; selected-agent detail | Trophy, blended ranking, repeated channel charts, workflow events |
| Acquisition | Ranked source volume; common-horizon cohort conversion; median/P75 scheduled-visit delay with N | Donut, independent-period pseudo-funnel, repeated source cards |
| Follow-ups | Common-horizon linked cohort; full open-queue aging/category; structured attempt outcomes | Free-text Positive funnel |
| Revenue | Invoice-date billed trend; CRM source mix; separately labeled acquisition-ledger coverage | Duplicate cards and overlapping-population waterfall |
| Attribution | Source completeness; invoice match review reasons; compact field completeness | Duplicate source/agent charts and misplaced doctor/service mix |
| Data quality | Verified/no-show/unresolved partition; unresolved aging and reasons | Edit-event charts presented as quality |
| Ad performance | Explicit period-population table; eligible attendance denominator; maturity-aware campaign cohort if populated | Ambiguous percentages and unsupported ROI |

Call performance: include confirmation calls in the daily chart, standardize Bangladesh date presets, consolidate agent tally into its existing table, provide an accessible chart data table. Operational screens retain their forms/worklists; add compact scheduling/availability insights where their existing data supports them. Do not publish new performance claims from patient history or unvalidated event timestamps.

## Reporting

Add an admin-guarded v3 RPC that reads the established v2 contract and additional aggregate insights in one stable database snapshot. Keep v2 intact for rollback. No patient, billing, appointment or attribution records are changed.

- Cohorts are distinct contacts dated in the selected range. For horizon H, include only contact dates whose date + H is on/before the attendance eligibility cutoff. Count a linked non-cancelled scheduled visit and a strict verified visit on dates within contact date through contact date + H, inclusive. The scheduling stage measures scheduled visit occurrence, not when a booking was entered. Show immature contacts separately.
- Revenue trend uses the exact deduplicated CRM invoice population. Visit trend uses strict eligible appointments; recent dates are null, not zero. Historical evidence reflects current knowledge.
- Queue aging uses all open outgoing queue records by creation date as of report time, independently of the period. Unknown/future creation dates remain explicit. Do not label age overdue.
- Evidence reasons and aging partition unresolved eligible appointments. Completed-without-evidence is a subset, not an additional segment.
- Source completeness does not prove causal attribution. Revenue coverage remains within its own acquisition ledger; do not add it to the CRM subset.
- Ad attendance uses verified / eligible, with all appointments and unresolved shown separately; ad contacts with a linked appointment remain distinct from recorded intake bookings.

## Validation and release

1. Synthetic Postgres regression tests: cohort boundary/maturity/nesting, void/duplicate evidence, date-based revenue, queue totals/age, unknowns, access denial and zero cases.
2. Presentation unit tests, TypeScript, relevant lint and production build.
3. Browser review with synthetic populated/empty data at desktop/mobile widths; inspect all tabs, selectors, accessible data and console errors.
4. Apply only the reviewed additive reporting migration to the CRM project; verify aggregate totals and query time.
5. Push a reviewable branch/PR, require successful CI, deploy the intended Vercel production project and verify the exact live revision and charts. Retain the previous deployment for rollback.

Deferred pending data: cash collections/margin, ad CAC/ROAS, actual telephony answer/abandonment/service level, doctor capacity utilization, historical backlog reconstruction, and historical as-of evidence improvement. These are data prerequisites, not blank decorative panels.
