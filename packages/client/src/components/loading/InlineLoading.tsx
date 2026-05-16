import { Spinner, type SpinnerProps } from '@fluentui/react-components'
import { useAntiFlash } from './useAntiFlash'

interface InlineLoadingProps {
  /** Spinner size. Defaults to "extra-small". */
  size?: SpinnerProps['size']
  /** Optional accessible label (sr-only). */
  label?: string
  /** Anti-flash delay in milliseconds. Defaults to 150. */
  antiFlashDelayMs?: number
}

/**
 * **Level 3 — inline spinner.**
 *
 * Use inside a button, next to a label, or anywhere a small indicator is
 * needed while a micro-action (save, submit, delete) is in flight.
 * No positioning chrome — drops in wherever you need it.
 *
 * Features 150ms anti-flash delay and accessible role="status" + aria-live="polite".
 *
 * @example
 * <Button disabled={isPending}>
 *   {isPending ? <InlineLoading /> : 'Save'}
 * </Button>
 */
export function InlineLoading({ size = 'extra-small', label, antiFlashDelayMs = 150 }: InlineLoadingProps) {
  const shouldShow = useAntiFlash(antiFlashDelayMs)

  return (
    <span role="status" aria-live="polite" aria-busy="true" aria-label={label ?? 'Loading…'}>
      {shouldShow ? <Spinner size={size} /> : null}
    </span>
  )
}
