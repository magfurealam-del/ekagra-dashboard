import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '../app/globals.css'
import AppShell from '../components/AppShell'
import AdminDashboardPage from '../app/admin-dashboard/page'
import { TooltipProvider } from '../components/ui/tooltip'

document.addEventListener('click', (event) => {
  const link = (event.target as Element).closest('a')
  if (
    link &&
    link.getAttribute('href')?.startsWith('/') &&
    !link.getAttribute('href')?.startsWith('/?state=')
  ) {
    event.preventDefault()
    window.alert(
      `This preview uses synthetic data. The production navigation destination is ${link.getAttribute('href')}.`,
    )
  }
})
createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <strong>DESIGN PREVIEW · SYNTHETIC DATA · NOT PRODUCTION</strong>
        <div className="flex flex-wrap gap-3">
          {['ready', 'empty', 'missing', 'error', 'no-comparison', 'stale'].map(
            (state) => (
              <a className="underline" href={`/?state=${state}`} key={state}>
                {state}
              </a>
            ),
          )}
        </div>
      </div>
      <AdminDashboardPage />
    </AppShell>
  </TooltipProvider>,
)
