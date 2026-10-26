'use client'
import { useCallback, useEffect, useState } from 'react'
import { clinicDate } from '@/lib/dashboard-presentation'

/** Keep presets current when an open dashboard crosses clinic midnight. */
export function useClinicDay() {
  const [day, setDay] = useState(() => clinicDate())
  const refreshDay = useCallback(() => setDay(clinicDate()), [])
  useEffect(() => {
    const timer = window.setInterval(refreshDay, 60_000)
    window.addEventListener('focus', refreshDay)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshDay)
    }
  }, [refreshDay])
  return { day, refreshDay }
}
