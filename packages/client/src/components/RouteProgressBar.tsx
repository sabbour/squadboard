/**
 * RouteProgressBar — K4 Wave 21.
 *
 * A thin NProgress-style bar that animates at the top of the viewport on every
 * React Router navigation. Styled with Fluent 2 tokens (colorBrandBackground for
 * the bar, shadow4 for the glow). Controlled by the `routeProgressBar` user pref
 * (stored in localStorage under squadboard:prefs, default true).
 *
 * Implementation note: the app uses BrowserRouter (non-data-router), so
 * useNavigation() stays 'idle'. Instead we listen to useLocation() changes —
 * each pathname change triggers a brief 350ms animation cycle.
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { tokens } from '@fluentui/react-components'
import { useUserPrefs } from '../utils/userPrefs.ts'

const BAR_HEIGHT = 3
const ANIMATION_MS = 350

export default function RouteProgressBar() {
  const { prefs } = useUserPrefs()
  const location = useLocation()
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstRender = useRef(true)

  useEffect(() => {
    // Skip the very first render (initial page load).
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (!prefs.routeProgressBar) return

    // Clear any in-flight animation.
    if (timerRef.current) clearTimeout(timerRef.current)

    // Kick off: jump to ~20% immediately, then animate to 90%, then to 100%, then hide.
    setVisible(true)
    setWidth(20)

    const t1 = setTimeout(() => setWidth(90), 20)
    const t2 = setTimeout(() => setWidth(100), ANIMATION_MS)
    const t3 = setTimeout(() => {
      setVisible(false)
      setWidth(0)
    }, ANIMATION_MS + 200)

    timerRef.current = t3
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search])

  if (!prefs.routeProgressBar || !visible) return null

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: `${width}%`,
        height: `${BAR_HEIGHT}px`,
        background: tokens.colorBrandBackground,
        boxShadow: tokens.shadow4,
        transition: width === 20
          ? 'none'
          : `width ${ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    />
  )
}
