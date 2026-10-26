'use client'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'
import Nav from '@/components/Nav'
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { session } = useAuth()
  const workspace =
    session && pathname !== '/login' && pathname !== '/change-password'
  return (
    <>
      <Nav />
      <main
        id="main-content"
        className={
          workspace
            ? 'min-w-0 px-4 py-6 sm:px-6 lg:ml-60 lg:px-8 lg:py-8'
            : 'mx-auto max-w-7xl px-4 py-6'
        }
      >
        <div className="mx-auto max-w-[1600px]">{children}</div>
      </main>
    </>
  )
}
