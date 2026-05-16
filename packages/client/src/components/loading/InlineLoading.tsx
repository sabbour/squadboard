import { Spinner, type SpinnerProps } from '@fluentui/react-components'

interface InlineLoadingProps {
  /** Spinner size. Defaults to "extra-small". */
  size?: SpinnerProps['size']
  /** Optional accessible label (sr-only). */
  label?: string
}

/**
 * **Level 3 — inline spinner.**
 *
 * Use inside a button, next to a label, or anywhere a small indicator is
 * needed while a micro-action (save, submit, delete) is in flight.
 * No positioning chrome — drops in wherever you need it.
 *
 * @example
 * <Button disabled={isPending}>
 *   {isPending ? <InlineLoading /> : 'Save'}
 * </Button>
 */
export function InlineLoading({ size = 'extra-small', label }: InlineLoadingProps) {
  return (
    <span role="status" aria-busy="true" aria-label={label ?? 'Loading…'}>
      <Spinner size={size} />
    </span>
  )
}
