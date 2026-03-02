import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '--'
  const d = new Date(
    dateStr.replace(' ', 'T') +
      (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'),
  )
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '--'
  const d = new Date(
    dateStr.replace(' ', 'T') +
      (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'),
  )
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'never'
  const d = new Date(
    dateStr.replace(' ', 'T') +
      (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'),
  )
  if (isNaN(d.getTime())) return dateStr
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remainSecs = secs % 60
  if (mins < 60) return remainSecs > 0 ? `${mins}m ${remainSecs}s` : `${mins}m`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  return `${hours}h ${remainMins}m`
}

export function toQueryString(params?: Record<string, unknown>): string {
  if (!params) return ''
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  )
  if (entries.length === 0) return ''
  return new URLSearchParams(
    entries.map(([k, v]) => [k, String(v)]),
  ).toString()
}

export function getDaysOfWeekLabels(csv: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const indices = csv.split(',').map((s) => parseInt(s.trim(), 10))
  if (indices.length === 7) return 'Every day'
  return indices.map((i) => days[i] ?? '?').join(', ')
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Fallback for non-HTTPS (e.g. http://192.168.x.x)
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}

export function formatCurrency(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null) return '--'
  const cur = currency || 'USD'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${cur} ${amount.toFixed(2)}`
  }
}
