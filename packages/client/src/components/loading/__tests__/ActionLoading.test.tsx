/**
 * ActionLoading RTL test — K6 coverage
 *
 * Verifies:
 * - Renders role="status" and aria-live="polite"
 * - Has aria-busy="true" and aria-label set
 * - 150ms anti-flash delay: no Spinner immediately; appears after 150ms
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActionLoading } from '../ActionLoading'

describe('ActionLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  describe('accessibility', () => {
    it('renders with role="status"', () => {
      const { container } = render(<ActionLoading />)
      const wrapper = container.querySelector('[role="status"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('renders with aria-live="polite"', () => {
      const { container } = render(<ActionLoading />)
      const wrapper = container.querySelector('[aria-live="polite"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('renders with aria-busy="true"', () => {
      const { container } = render(<ActionLoading />)
      const wrapper = container.querySelector('[aria-busy="true"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('sets aria-label to default "Loading…" when not provided', () => {
      const { container } = render(<ActionLoading />)
      const wrapper = container.querySelector('[aria-label="Loading…"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('sets aria-label to provided label', () => {
      const label = 'Deleting…'
      const { container } = render(<ActionLoading label={label} />)
      const wrapper = container.querySelector(`[aria-label="${label}"]`)
      expect(wrapper).toBeInTheDocument()
    })
  })

  describe('anti-flash delay', () => {
    it('does not render Spinner immediately', () => {
      render(<ActionLoading />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it('renders Spinner after 150ms', () => {
      render(<ActionLoading />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

      vi.advanceTimersByTime(150)

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    it('respects custom antiFlashDelayMs prop', () => {
      render(<ActionLoading antiFlashDelayMs={200} />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

      vi.advanceTimersByTime(200)

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })
  })

  describe('layout', () => {
    it('renders as a span element', () => {
      const { container } = render(<ActionLoading />)
      const span = container.querySelector('span[role="status"]')
      expect(span).toBeInTheDocument()
    })

    it('uses display: contents style', () => {
      const { container } = render(<ActionLoading />)
      const span = container.querySelector('span[role="status"]')
      expect(span).toHaveStyle({ display: 'contents' })
    })
  })
})
