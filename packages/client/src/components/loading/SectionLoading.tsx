import { Spinner, type SpinnerProps } from '@fluentui/react-components'

interface SectionLoadingProps {
  /** Optional contextual label. When omitted only the spinner is shown. */
  label?: string
  /** Spinner size. Defaults to "small". */
  size?: SpinnerProps['size']
}

/**
 * **Level 2 — in-place section/card spinner.**
 *
 * Use inside a card, panel, or tab body while its content loads, leaving the
 * rest of the page interactive. Enforces a minimum height so the container
 * does not collapse to zero.
 *
 * @example
 * {isLoading ? <SectionLoading label="Loading members…" /> : <MemberList />}
 */
export function SectionLoading({ label, size = 'small' }: SectionLoadingProps) {
  return (
    <div
      role="status"
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
      <Spinner label={label} size={size} />
    </div>
  )
}
