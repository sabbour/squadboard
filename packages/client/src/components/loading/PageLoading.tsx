import { type ReactNode } from 'react'
import { Spinner, tokens, type SpinnerProps } from '@fluentui/react-components'
import { useAntiFlash } from './useAntiFlash'

interface PageLoadingProps {
  /** Contextual label shown beneath the spinner. Defaults to "Loading…" */
  label?: string
  /**
   * Optional header node (e.g. `<PageHeader … />`).
   * When supplied the spinner fills the remaining height beneath the header.
   * When omitted the spinner is centred in the full viewport height.
   */
  header?: ReactNode
  /** Spinner size. Defaults to "medium". */
  size?: SpinnerProps['size']
  /** Anti-flash delay in milliseconds. Defaults to 150. */
  antiFlashDelayMs?: number
}

/**
 * **Level 1 — full-page replacement.**
 *
 * Use when an entire page is in `isLoading` and there is nothing else to show.
 *
 * Features 150ms anti-flash delay to prevent spinners flashing on quick loads.
 * Accessible with role="status", aria-live="polite", aria-busy, and aria-label.
 *
 * @example
 * if (isLoading) return <PageLoading label="Loading costs…" />
 * if (isLoading) return <PageLoading header={<PageHeader … />} label="Loading…" />
 */
export function PageLoading({ label = 'Loading…', header, size = 'medium', antiFlashDelayMs = 150 }: PageLoadingProps) {
  const shouldShow = useAntiFlash(antiFlashDelayMs)

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: tokens.colorNeutralBackground1,
      }}
    >
      {header}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {shouldShow ? <Spinner label={label} size={size} /> : null}
      </div>
    </div>
  )
}
