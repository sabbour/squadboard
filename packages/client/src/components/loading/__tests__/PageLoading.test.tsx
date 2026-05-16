/**
 * PageLoading RTL test — K6 coverage
 *
 * Verifies:
 * - Renders role="status" and aria-live="polite"
 * - Has aria-busy="true" and aria-label set
 * - 150ms anti-flash delay: immediate render shows no Spinner; after 150ms Spinner appears
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { PageLoading } from '../PageLoading'

describe('PageLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('accessibility', () => {
    it('renders with role="status"', () => {
      const { container } = render(<PageLoading label="Loading…" />)
      const wrapper = container.querySelector('[role="status"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('renders with aria-live="polite"', () => {
      const { container } = render(<PageLoading label="Loading…" />)
      const wrapper = container.querySelector('[aria-live="polite"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('renders with aria-busy="true"', () => {
      const { container } = render(<PageLoading label="Loading…" />)
      const wrapper = container.querySelector('[aria-busy="true"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('sets aria-label to the provided label', () => {
      const label = 'Loading costs…'
      const { container } = render(<PageLoading label={label} />)
      const wrapper = container.querySelector(`[aria-label="${label}"]`)
      expect(wrapper).toBeInTheDocument()
    })

    it('uses default label "Loading…" when not provided', () => {
      const { container } = render(<PageLoading />)
      const wrapper = container.querySelector('[aria-label="Loading…"]')
      expect(wrapper).toBeInTheDocument()
    })
  })

  describe('anti-flash delay', () => {
    it('does not render Spinner immediately', () => {
      render(<PageLoading label="Loading…" />)
      // Spinner should not be visible yet
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it('renders Spinner after 150ms', () => {
      render(<PageLoading label="Loading…" />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(150)
      })

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    it('respects custom antiFlashDelayMs prop', () => {
      render(<PageLoading label="Loading…" antiFlashDelayMs={100} />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(100)
      })

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })
  })

  describe('props', () => {
    it('accepts optional header prop', () => {
      const header = <div data-testid="test-header">Header Content</div>
      const { getByTestId } = render(
        <PageLoading label="Loading…" header={header} />
      )
      expect(getByTestId('test-header')).toBeInTheDocument()
    })

    it('accepts size prop and passes to Spinner', () => {
      render(<PageLoading label="Loading…" size="large" />)
      act(() => {
        vi.advanceTimersByTime(150)
      })
      // Verify Spinner was rendered (size is applied internally by Spinner)
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })
  })
})

