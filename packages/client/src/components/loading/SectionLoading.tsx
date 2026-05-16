import { Spinner, type SpinnerProps } from '@fluentui/react-components'
import { useAntiFlash } from './useAntiFlash'

interface SectionLoadingProps {
  /** Optional contextual label. When omitted only the spinner is shown. */
  label?: string
  /** Spinner size. Defaults to "small". */
  size?: SpinnerProps['size']
  /** Anti-flash delay in milliseconds. Defaults to 150. */
  antiFlashDelayMs?: number
}

/**
 * **Level 2 — in-place section/card spinner.**
 *
 * Use inside a card, panel, or tab body while its content loads, leaving the
 * rest of the page interactive. Enforces a minimum height so the container
 * does not collapse to zero.
 *
 * Features 150ms anti-flash delay and accessible role="status" + aria-live="polite".
 *
 * @example
 * {isLoading ? <SectionLoading label="Loading members…" /> : <MemberList />}
 */
export function SectionLoading({ label, size = 'small', antiFlashDelayMs = 150 }: SectionLoadingProps) {
  const shouldShow = useAntiFlash(antiFlashDelayMs)

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label ?? 'Loading…'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '120px',
        width: '100%',
      }}
    >
      {shouldShow ? <Spinner label={label} size={size} /> : null}
    </div>
  )
}
