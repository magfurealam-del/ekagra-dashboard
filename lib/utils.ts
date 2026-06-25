export function normalizeBDPhone(phone: string): string | null {
  if (!phone) return null
  let p = phone.replace(/[\s\-\(\)]/g, '')
  p = p.replace(/[^\d+]/g, '')
  if (p.startsWith('+8801') && p.length === 14) return p
  if (p.startsWith('8801') && p.length === 13) return '+' + p
  if (p.startsWith('01') && p.length === 11) return '+880' + p.slice(1)
  return null
}

export function formatCurrency(amount: number | null): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-BD', {
    style: 'currency', currency: 'BDT', minimumFractionDigits: 0
  }).format(amount).replace('BDT', '৳')
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  })
}

export function formatPhone(phone: string | null): string {
  if (!phone) return '—'
  const norm = normalizeBDPhone(phone)
  if (!norm) return phone
  return norm.replace(/(\+880)(\d{2})(\d{4})(\d{4})/, '$1 $2 $3 $4')
}

export function getStatusColor(status: string | null): string {
  const colors: Record<string, string> = {
    'Appointment done': 'bg-green-100 text-green-800',
    'Appointment Done': 'bg-green-100 text-green-800',
    'No appointment yet': 'bg-yellow-100 text-yellow-800',
    'No Show': 'bg-red-100 text-red-800',
    'Not interested': 'bg-gray-100 text-gray-600',
    'Not Interested': 'bg-gray-100 text-gray-600',
    'Wrong number': 'bg-red-100 text-red-800',
    'Rescheduled': 'bg-blue-100 text-blue-800',
    'General Inquiry': 'bg-purple-100 text-purple-800',
  }
  return colors[status || ''] || 'bg-gray-100 text-gray-600'
}

export function getPriorityColor(priority: string | null): string {
  const colors: Record<string, string> = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-green-100 text-green-700',
  }
  return colors[priority || 'medium'] || 'bg-gray-100 text-gray-600'
}

export function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

export function getTomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}
