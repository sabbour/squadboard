/**
 * SectionLoading RTL test — K6 coverage
 *
 * Verifies:
 * - Renders role="status" and aria-live="polite"
 * - Has aria-busy="true" and aria-label set
 * - 150ms anti-flash delay: no Spinner immediately; appears after 150ms
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SectionLoading } from '../SectionLoading'

describe('SectionLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  describe('accessibility', () => {
    it('renders with role="status"', () => {
      const { container } = render(<SectionLoading label="Loading…" />)
      const wrapper = container.querySelector('[role="status"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('renders with aria-live="polite"', () => {
      const { container } = render(<SectionLoading label="Loading…" />)
      const wrapper = container.querySelector('[aria-live="polite"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('renders with aria-busy="true"', () => {
      const { container } = render(<SectionLoading label="Loading…" />)
      const wrapper = container.querySelector('[aria-busy="true"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('sets aria-label to the provided label', () => {
      const label = 'Loading members…'
      const { container } = render(<SectionLoading label={label} />)
      const wrapper = container.querySelector(`[aria-label="${label}"]`)
      expect(wrapper).toBeInTheDocument()
    })

    it('uses default label "Loading…" when not provided', () => {
      const { container } = render(<SectionLoading />)
      const wrapper = container.querySelector('[aria-label="Loading…"]')
      expect(wrapper).toBeInTheDocument()
    })
  })

  describe('anti-flash delay', () => {
    it('does not render Spinner immediately', () => {
      render(<SectionLoading label="Loading…" />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it('renders Spinner after 150ms', () => {
      render(<SectionLoading label="Loading…" />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

      vi.advanceTimersByTime(150)

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    it('respects custom antiFlashDelayMs prop', () => {
      render(<SectionLoading label="Loading…" antiFlashDelayMs={75} />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

      vi.advanceTimersByTime(75)

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })
  })

  describe('props', () => {
    it('accepts size prop', () => {
      render(<SectionLoading label="Loading…" size="large" />)
      vi.advanceTimersByTime(150)
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    it('renders Spinner with provided label', () => {
      const label = 'Loading section…'
      render(<SectionLoading label={label} />)
      vi.advanceTimersByTime(150)
      expect(screen.getByText(label)).toBeInTheDocument()
    })

    it('enforces minHeight via style', () => {
      const { container } = render(<SectionLoading />)
      const wrapper = container.querySelector('[role="status"]')
      expect(wrapper).toHaveStyle({ minHeight: '120px' })
    })
  })
})
