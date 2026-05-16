import { useEffect, useState } from 'react'

/**
 * Anti-flash delay hook for loading spinners.
 *
 * Returns `false` for the first `delayMs` milliseconds, then `true` thereafter.
 * This prevents spinners from "flashing" on the screen when content loads quickly.
 *
 * Recommended usage:
 * ```tsx
 * const shouldShow = useAntiFlash(150)
 * return shouldShow ? <Spinner /> : null
 * ```
 *
 * @param delayMs - Delay in milliseconds before returning true. Defaults to 150.
 * @returns boolean — false during delay window, true after.
 */
export function useAntiFlash(delayMs: number = 150): boolean {
  const [shouldShow, setShouldShow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setShouldShow(true)
    }, delayMs)

    return () => clearTimeout(timer)
  }, [delayMs])

  return shouldShow
}
