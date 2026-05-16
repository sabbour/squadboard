/**
 * Loading component family — canonical Fluent2 loading patterns for Squadboard.
 *
 * Three levels, three components. Pick the right one based on what is loading:
 *
 * @example
 * // Level 1 — whole page not ready yet (no content to show)
 * <PageLoading label="Loading costs…" />
 *
 * // Level 1 — whole page with preserved header
 * <PageLoading header={<PageHeader eyebrow="PROJECT" title="Ceremonies" />} label="Loading ceremonies…" />
 *
 * // Level 2 — a card or panel section is loading, rest of page is interactive
 * <SectionLoading label="Loading members…" />
 *
 * // Level 3 — inline, inside a button or next to a label
 * <InlineLoading />
 *
 * Created: 2026-05-15
 * Canonical pattern source: pages/CeremonyList.tsx lines 104–131
 */

import { type ReactNode } from 'react'
import { Spinner, tokens, type SpinnerProps } from '@fluentui/react-components'

// ---------------------------------------------------------------------------
// Level 1 — PageLoading
// ---------------------------------------------------------------------------

interface PageLoadingProps {
  /** Contextual label shown beneath the spinner. Defaults to "Loading…" */
  label?: string
  /**
   * Optional header node (e.g. `<PageHeader … />`).
   * When supplied the spinner fills the remaining height beneath the header,
   * matching the CeremonyList shape exactly.
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
 * Two variants:
 * - No `header` prop → spinner centred in the full viewport height.
 * - With `header` prop → header rendered at top, spinner fills remaining height
 *   (the CeremonyList canonical shape).
 *
 * @example
 * if (isLoading) return <PageLoading label="Loading costs…" />
 *
 * @example
 * if (isLoading) return (
 *   <PageLoading
 *     header={<PageHeader eyebrow="PROJECT" title="Ceremonies" />}
 *     label="Loading ceremonies…"
 *   />
 * )
 */
export function PageLoading({ label = 'Loading…', header, size = 'medium' }: PageLoadingProps) {
  return (
    <div
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

// ---------------------------------------------------------------------------
// Level 2 — SectionLoading
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Level 3 — InlineLoading
// ---------------------------------------------------------------------------

interface InlineLoadingProps {
  /** Spinner size. Defaults to "extra-small". */
  size?: SpinnerProps['size']
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
export function InlineLoading({ size = 'extra-small' }: InlineLoadingProps) {
  return <Spinner size={size} />
}
