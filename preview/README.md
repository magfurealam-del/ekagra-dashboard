# Local UI review

Run `npm run preview:ui` from the project root. Open `http://127.0.0.1:4173/`.

The preview renders the real dashboard, header, navigation, and shared components. Vite aliases replace authentication, Supabase, Next navigation, and Link only for this preview. No production auth code is bypassed or changed. Fixture values are invented and visibly labeled synthetic. Never add credentials or patient records here.

The state links exercise populated, empty, missing snapshot, error, missing comparison, and stale snapshots. Operational links show their intended route rather than calling live workflows. The fixture date controls exercise state handling; the synthetic query does not model all production filters or detail RPCs.

The production application remains Next.js; Vite is a development-only review tool. The server binds to loopback only.
