// Mirrors normalize_bd_phone() in Supabase for client-side preview matching.
export function normalizeBdPhone(input: string): string {
  if (!input) return ''
  let d = input.replace(/[\s\-()+]/g, '')
  d = d.replace(/\D/g, '')
  if (d.startsWith('880')) d = d.slice(3)
  if (d.startsWith('0')) d = d.slice(1)
  return '+880' + d
}
