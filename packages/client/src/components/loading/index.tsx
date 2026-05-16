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
 *
 * Wave 20 K2: components extracted to individual files. This barrel re-exports
 * all three for backward-compat import paths.
 */

export { PageLoading } from './PageLoading.tsx'
export { SectionLoading } from './SectionLoading.tsx'
export { InlineLoading } from './InlineLoading.tsx'
export { ActionLoading } from './ActionLoading.tsx'


