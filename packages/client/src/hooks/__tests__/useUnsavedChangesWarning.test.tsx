import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { useUnsavedChangesWarning } from '../useUnsavedChangesWarning.ts'

function Harness({ when = true, message = 'Unsaved?' }: { when?: boolean; message?: string }) {
  useUnsavedChangesWarning(when, message)
  return <a href="/next">Next</a>
}

describe('useUnsavedChangesWarning', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('renders under BrowserRouter without requiring a data router', () => {
    expect(() => {
      render(
        <BrowserRouter>
          <Harness />
        </BrowserRouter>,
      )
    }).not.toThrow()
  })

  it('warns before a browser unload when dirty', () => {
    render(
      <BrowserRouter>
        <Harness message="Dirty ceremony?" />
      </BrowserRouter>,
    )

    const event = new Event('beforeunload', { cancelable: true })
    const prevented = !window.dispatchEvent(event)

    expect(prevented).toBe(true)
  })

  it('cancels same-origin link navigation when the user declines', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { getByRole } = render(
      <BrowserRouter>
        <Harness message="Dirty ceremony?" />
      </BrowserRouter>,
    )

    const allowed = fireEvent.click(getByRole('link', { name: 'Next' }))

    expect(confirm).toHaveBeenCalledWith('Dirty ceremony?')
    expect(allowed).toBe(false)
    expect(window.location.pathname).toBe('/')
  })

  it('does not prompt when the page is clean', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <BrowserRouter>
        <Harness when={false} />
      </BrowserRouter>,
    )

    const event = new Event('beforeunload', { cancelable: true })
    const prevented = !window.dispatchEvent(event)

    expect(prevented).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
  })
})
