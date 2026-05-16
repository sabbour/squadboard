import { Spinner } from '@fluentui/react-components'
import { useAntiFlash } from './useAntiFlash'

interface ActionLoadingProps {
  /** Accessible label for the spinner (sr-only when no visible label). Defaults to "Loading…" */
  label?: string
  /** Anti-flash delay in milliseconds. Defaults to 150. */
  antiFlashDelayMs?: number
}

/**
 * **Button-icon spinner.**
 *
 * Drop-in replacement for ad-hoc `<Spinner size="tiny" />` used inside a
 * Fluent `<Button icon={…}>`. Sized at `"tiny"` to match the button-icon slot
 * dimensions. Wraps the spinner in a `role="status"` span so screen readers
 * announce the pending state.
 *
 * Features 150ms anti-flash delay and aria-live="polite".
 *
 * @example
 * <Button icon={isPending ? <ActionLoading /> : <Save20Regular />}>Save</Button>
 *
 * // With an explicit label for better accessibility:
 * <Button icon={isPending ? <ActionLoading label="Saving…" /> : <Save20Regular />}>Save</Button>
 */
export function ActionLoading({ label = 'Loading…', antiFlashDelayMs = 150 }: ActionLoadingProps) {
  const shouldShow = useAntiFlash(antiFlashDelayMs)

  return (
    <span role="status" aria-live="polite" aria-busy="true" aria-label={label} style={{ display: 'contents' }}>
      {shouldShow ? <Spinner size="tiny" /> : null}
    </span>
  )
}
