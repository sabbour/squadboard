import { Spinner } from '@fluentui/react-components'

interface ActionLoadingProps {
  /** Accessible label for the spinner (sr-only when no visible label). Defaults to "Loading…" */
  label?: string
}

/**
 * **Button-icon spinner.**
 *
 * Drop-in replacement for ad-hoc `<Spinner size="tiny" />` used inside a
 * Fluent `<Button icon={…}>`. Sized at `"tiny"` to match the button-icon slot
 * dimensions. Wraps the spinner in a `role="status"` span so screen readers
 * announce the pending state.
 *
 * @example
 * <Button icon={isPending ? <ActionLoading /> : <Save20Regular />}>Save</Button>
 *
 * // With an explicit label for better accessibility:
 * <Button icon={isPending ? <ActionLoading label="Saving…" /> : <Save20Regular />}>Save</Button>
 */
export function ActionLoading({ label = 'Loading…' }: ActionLoadingProps) {
  return (
    <span role="status" aria-busy="true" aria-label={label} style={{ display: 'contents' }}>
      <Spinner size="tiny" />
    </span>
  )
}
