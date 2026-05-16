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
}

const DEFAULT_PREFS: UserPrefs = {
  routeProgressBar: true,
}

function loadPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<UserPrefs>) }
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
