/**
 * userPrefs — lightweight localStorage-backed user preferences.
 *
 * Preferences are stored as a single JSON object under `squadboard:prefs`.
 * The hook provides a reactive `prefs` object and a `setPref` setter.
 *
 * Defaults:
 *   routeProgressBar: true
 */

import { useCallback, useEffect, useState } from 'react'

const PREFS_KEY = 'squadboard:prefs'

export interface UserPrefs {
  /** Show a thin progress bar at the top during route transitions. Default: true. */
  routeProgressBar: boolean
  /** Project index search/filter/sort state. Browser-local only. */
  projectIndex: ProjectIndexPrefs
}

export type ProjectIndexFilter = 'all' | 'regular' | 'test'
export type ProjectIndexSort = 'recent' | 'name' | 'path'

export interface ProjectIndexPrefs {
  query: string
  filter: ProjectIndexFilter
  sortBy: ProjectIndexSort
}

const DEFAULT_PREFS: UserPrefs = {
  routeProgressBar: true,
  projectIndex: {
    query: '',
    filter: 'all',
    sortBy: 'recent',
  },
}

const PROJECT_INDEX_FILTERS = new Set<ProjectIndexFilter>(['all', 'regular', 'test'])
const PROJECT_INDEX_SORTS = new Set<ProjectIndexSort>(['recent', 'name', 'path'])

function normalizeProjectIndexPrefs(value: unknown): ProjectIndexPrefs {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PREFS.projectIndex }
  const raw = value as Partial<ProjectIndexPrefs>
  return {
    query: typeof raw.query === 'string' ? raw.query : '',
    filter: raw.filter && PROJECT_INDEX_FILTERS.has(raw.filter) ? raw.filter : 'all',
    sortBy: raw.sortBy && PROJECT_INDEX_SORTS.has(raw.sortBy) ? raw.sortBy : 'recent',
  }
}

function loadPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw) as Partial<UserPrefs>
    return {
      ...DEFAULT_PREFS,
      routeProgressBar: typeof parsed.routeProgressBar === 'boolean'
        ? parsed.routeProgressBar
        : DEFAULT_PREFS.routeProgressBar,
      projectIndex: normalizeProjectIndexPrefs(parsed.projectIndex),
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function savePrefs(prefs: UserPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage unavailable — silently ignore
  }
}

export function useUserPrefs() {
  const [prefs, setPrefs] = useState<UserPrefs>(loadPrefs)

  // Re-sync when another tab writes to localStorage.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === PREFS_KEY) setPrefs(loadPrefs())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setPref = useCallback(<K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value }
      savePrefs(next)
      return next
    })
  }, [])

  return { prefs, setPref }
}
