export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export type DoctorSession = { day_of_week: number; start_time: string; end_time: string; slot_minutes?: number; is_active?: boolean; doctor_name?: string }
export type DailyOverride = { is_available: boolean; start_time?: string | null; end_time?: string | null }
const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m }
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`

export function doctorNameVariants(name: string): string[] {
  const base = name.split(/\s+[—–]\s+/)[0].trim()
  return [...new Set([base, base.replace(/^dr\.?\s*/i, 'Dr. '), base.replace(/^dr\.?\s*/i, 'Dr ')])]
}

export function uniqueDoctorNames(names: string[]): string[] {
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const key = name.toLowerCase().replace(/[.\s]+/g, '')
    groups.set(key, [...(groups.get(key) || []), name])
  }
  return [...groups.values()].map(group => [...group].sort((a, b) => Number(/^Dr\./i.test(b)) - Number(/^Dr\./i.test(a)) || a.localeCompare(b))[0]).sort((a, b) => a.localeCompare(b))
}

/** A reduced-hours override clips each session, preserving the break between them. */
export function effectiveSessions(sessions: DoctorSession[], override?: DailyOverride | null): DoctorSession[] {
  if (override?.is_available === false) return []
  return sessions.filter(s => s.is_active !== false).map(s => {
    const start = Math.max(minutes(s.start_time), override?.start_time ? minutes(override.start_time) : 0)
    const end = Math.min(minutes(s.end_time), override?.end_time ? minutes(override.end_time) : 1440)
    return { ...s, start_time: clock(start), end_time: clock(end) }
  }).filter(s => minutes(s.start_time) < minutes(s.end_time)).sort((a, b) => a.start_time.localeCompare(b.start_time))
}

export function doctorSlots(sessions: DoctorSession[], date: string, override?: DailyOverride | null): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
  const dow = new Date(date + 'T00:00:00Z').getUTCDay()
  const result = new Set<string>()
  for (const s of effectiveSessions(sessions.filter(s => s.day_of_week === dow), override)) {
    const step = s.slot_minutes ?? 15
    if (!Number.isInteger(step) || step < 5 || step > 120) continue
    for (let value = minutes(s.start_time); value + step <= minutes(s.end_time); value += step) result.add(clock(value))
  }
  return [...result].sort()
}

export function sessionValidation(sessions: DoctorSession[]): string | null {
  for (const s of sessions) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start_time) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end_time)) return 'Enter valid start and end times.'
    if (s.start_time >= s.end_time) return 'Each session must end after it starts.'
    if (!Number.isInteger(s.slot_minutes ?? 15) || (s.slot_minutes ?? 15) < 5 || (s.slot_minutes ?? 15) > 120) return 'Slot length must be 5–120 minutes.'
  }
  for (let dow = 0; dow < 7; dow++) {
    const day = sessions.filter(s => s.day_of_week === dow && s.is_active !== false).sort((a, b) => a.start_time.localeCompare(b.start_time))
    if (day.some((s, i) => i > 0 && day[i - 1].end_time > s.start_time)) return `${WEEKDAYS[dow]} sessions overlap. Keep them separate.`
  }
  return null
}

export function parseScheduleCell(cell: string, dow: number): DoctorSession[] {
  if (!cell.trim() || /^(off|closed|-|n\/a)$/i.test(cell.trim())) return []
  const rows = cell.split(';').map(value => {
    const match = value.trim().match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/)
    if (!match) throw new Error(`${WEEKDAYS[dow]}: use 14:00-16:00;18:00-20:00 or OFF.`)
    return { day_of_week: dow, start_time: match[1].padStart(5, '0'), end_time: match[2].padStart(5, '0'), slot_minutes: 15, is_active: true }
  })
  const error = sessionValidation(rows)
  if (error) throw new Error(error)
  return rows
}

export function scheduleCell(rows: DoctorSession[]): string {
  return rows.filter(s => s.is_active !== false).sort((a, b) => a.start_time.localeCompare(b.start_time)).map(s => `${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`).join(';') || 'OFF'
}

export function parseScheduleCsv(text: string): (DoctorSession & { doctor_name: string })[] {
  const split = (line: string) => {
    const cells: string[] = []; let value = ''; let quoted = false
    for (let n = 0; n < line.length; n++) {
      const char = line[n]
      if (char === '"') { if (quoted && line[n + 1] === '"') { value += '"'; n++ } else quoted = !quoted }
      else if (char === ',' && !quoted) { cells.push(value.trim()); value = '' } else value += char
    }
    if (quoted) throw new Error('CSV has an unclosed quote.')
    cells.push(value.trim()); return cells
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) throw new Error('CSV has no data rows.')
  const header = split(lines[0]).map(s => s.toLowerCase()), doctorCol = header.indexOf('doctor'), columns = WEEKDAYS.map(d => header.indexOf(d.toLowerCase()))
  if (doctorCol < 0 || columns.some(c => c < 0)) throw new Error('CSV must include Doctor and all seven weekdays.')
  const rows: (DoctorSession & { doctor_name: string })[] = [], seen = new Set<string>()
  for (const line of lines.slice(1)) {
    const cells = split(line), name = cells[doctorCol], key = name?.toLowerCase().replace(/[.\s]+/g, '')
    if (!name || seen.has(key)) throw new Error('Each doctor must appear exactly once in the CSV.')
    if (cells.length !== header.length) throw new Error(`Incomplete CSV row for ${name}.`)
    seen.add(key)
    columns.forEach((column, dow) => {
      const sessions = parseScheduleCell(cells[column], dow)
      rows.push(...(sessions.length ? sessions : [{ day_of_week: dow, start_time: '09:00', end_time: '21:00', slot_minutes: 15, is_active: false }]).map(s => ({ ...s, doctor_name: name })))
    })
  }
  return rows
}
