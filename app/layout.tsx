import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import { AuthProvider } from '@/lib/AuthContext'

export const metadata: Metadata = {
  title: 'Ekagra Call Center',
  description: 'Patient intake, appointments, and follow-up workflow',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <AuthProvider>
          <Nav />
          <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
        </AuthProvider>
      </body>
    </html>
  )
}
