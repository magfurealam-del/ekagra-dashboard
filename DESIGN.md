# Ekagra Call Center design system

The executive dashboard should answer: What changed? Which result can we trust? Where should the team act?

- Foundation: official shadcn/ui, Radix Nova preset, React 19, Tailwind 4. Installed source components are editable; retain upstream conventions and accessibility behavior.
- Typography: locally bundled Geist Variable; 30–34px page heading, 24–32px headline metrics, 16px section headings, 14px controls/body, 12px supporting metadata. Use tabular numerals for values. Never use color alone to convey a result.
- Palette: teal #0f766e for active navigation/actions, slate #18252b for text, #52616b for supporting text, #f6f8fa workspace, white surfaces, #e1e7eb borders. Amber marks evidence requiring review, not assumed failure. No decorative gradients.
- Navigation: 240px desktop sidebar grouped into Intelligence, Daily operations, Administration. Below 1024px, a labeled modal drawer with focus trapping and Escape dismissal. Preserve role filtering and authentication guards.
- Hierarchy: page identity → reporting controls → dates/freshness → section selection → four decision metrics → trend and priorities → source mix/outcomes. Compact selects replace the long button groups on mobile.
- Spacing: 4px base; 12px metric gaps, 20–24px panel spacing/padding, 32px desktop outer padding. Small controls 8px radius; grouped surfaces 12px. Minimal shadow.
- Interaction: keyboard-visible focus, explicit labels, accessible tooltip buttons, useful loading/error/empty states, 40–44px primary touch controls. Respect reduced motion. Provide a table alternative to charts.
- Data: never substitute zero for unavailable executive metrics. Show the snapshot timestamp; callback counts are as-of-snapshot. Percentage changes use a nonzero prior denominator; booking-rate changes are percentage points. A count increase is not automatically good. Never fabricate targets or alerts.
- Evidence: strict MIS-verified visits and explicit CRM no-show status are distinct. Do not relabel invoice proximity as verified attendance. Do not connect lead creation and appointment-date populations into a conversion funnel.
- Scope: light theme is the verified theme. Dark mode and full legacy-screen redesign are separate work.

See `docs/executive-reporting-contract.md` for reporting definitions and release validation.
