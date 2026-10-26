import type { Metadata } from 'next'
import '@fontsource-variable/geist'
import './globals.css'
import AppShell from '@/components/AppShell'
import { AuthProvider } from '@/lib/AuthContext'
import { TooltipProvider } from '@/components/ui/tooltip'
export const metadata: Metadata = {
  title: 'Ekagra Call Center',
  description: 'Patient intake, appointments, and executive intelligence',
}
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthProvider>
          <TooltipProvider>
            <AppShell>{children}</AppShell>
          </TooltipProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
