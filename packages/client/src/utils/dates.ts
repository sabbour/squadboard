import { formatDistanceToNow, format } from 'date-fns'

/**
 * Safely formats a date value as a relative time string (e.g. "3 minutes ago").
 * Returns fallback (default "—") for null, undefined, or unparseable values.
 */
export function safeRelativeTime(value: unknown, opts: { fallback?: string } = {}): string {
  const fallback = opts.fallback ?? '—'
  if (value == null) return fallback
  const d = new Date(value as string | number | Date)
  if (Number.isNaN(d.getTime())) return fallback
  try {
    return formatDistanceToNow(d, { addSuffix: true })
  } catch {
    return fallback
  }
}

/**
 * Safely formats a date value using a date-fns format string.
 * Returns fallback (default "—") for null, undefined, or unparseable values.
 */
export function safeFormatDate(value: unknown, fmt = 'PPp', opts: { fallback?: string } = {}): string {
  const fallback = opts.fallback ?? '—'
  if (value == null) return fallback
  const d = new Date(value as string | number | Date)
  if (Number.isNaN(d.getTime())) return fallback
  try {
    return format(d, fmt)
  } catch {
    return fallback
  }
}

/**
 * Safely formats a date value as a locale-aware absolute timestamp.
 * Returns fallback (default "—") for null, undefined, or unparseable values.
 */
export function safeAbsoluteTime(value: unknown, opts: { fallback?: string } = {}): string {
  const fallback = opts.fallback ?? '—'
  if (value == null) return fallback
  const d = new Date(value as string | number | Date)
  if (Number.isNaN(d.getTime())) return fallback
  try {
    return d.toLocaleString()
  } catch {
    return fallback
  }
}
