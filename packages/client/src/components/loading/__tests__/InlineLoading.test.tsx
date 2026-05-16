/**
 * InlineLoading RTL test — K6 coverage
 *
 * Verifies:
 * - Renders role="status" and aria-live="polite"
 * - Has aria-busy="true" and aria-label set
 * - 150ms anti-flash delay: no Spinner immediately; appears after 150ms
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InlineLoading } from '../InlineLoading'

describe('InlineLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  describe('accessibility', () => {
    it('renders with role="status"', () => {
      const { container } = render(<InlineLoading />)
      const wrapper = container.querySelector('[role="status"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('renders with aria-live="polite"', () => {
      const { container } = render(<InlineLoading />)
      const wrapper = container.querySelector('[aria-live="polite"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('renders with aria-busy="true"', () => {
      const { container } = render(<InlineLoading />)
      const wrapper = container.querySelector('[aria-busy="true"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('sets aria-label to default "Loading…" when not provided', () => {
      const { container } = render(<InlineLoading />)
      const wrapper = container.querySelector('[aria-label="Loading…"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('sets aria-label to provided label', () => {
      const label = 'Saving…'
      const { container } = render(<InlineLoading label={label} />)
      const wrapper = container.querySelector(`[aria-label="${label}"]`)
      expect(wrapper).toBeInTheDocument()
    })
  })

  describe('anti-flash delay', () => {
    it('does not render Spinner immediately', () => {
      render(<InlineLoading />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it('renders Spinner after 150ms', () => {
      render(<InlineLoading />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

      vi.advanceTimersByTime(150)

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    it('respects custom antiFlashDelayMs prop', () => {
      render(<InlineLoading antiFlashDelayMs={50} />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

      vi.advanceTimersByTime(50)

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })
  })

  describe('props', () => {
    it('accepts size prop', () => {
      render(<InlineLoading size="small" />)
      vi.advanceTimersByTime(150)
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    it('renders as a span element', () => {
      const { container } = render(<InlineLoading />)
      const span = container.querySelector('span[role="status"]')
      expect(span).toBeInTheDocument()
    })
  })
})
