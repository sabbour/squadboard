import { type ReactNode } from 'react'
import { Spinner, tokens, type SpinnerProps } from '@fluentui/react-components'

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
}

/**
 * **Level 1 — full-page replacement.**
 *
 * Use when an entire page is in `isLoading` and there is nothing else to show.
 *
 * @example
 * if (isLoading) return <PageLoading label="Loading costs…" />
 */
export function PageLoading({ label = 'Loading…', header, size = 'medium' }: PageLoadingProps) {
  return (
    <div
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
        <Spinner label={label} size={size} />
      </div>
    </div>
  )
}
