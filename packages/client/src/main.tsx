import React from 'react'
import ReactDOM from 'react-dom/client'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, HashRouter } from 'react-router'
import App from './App.tsx'
import './styles/globals.css'

const isElectron =
  typeof window !== 'undefined' &&
  window.navigator.userAgent.toLowerCase().includes('electron')

const Router = isElectron ? HashRouter : BrowserRouter

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FluentProvider theme={webLightTheme} style={{ height: '100%' }}>
      <QueryClientProvider client={queryClient}>
        <Router>
          <App />
        </Router>
      </QueryClientProvider>
    </FluentProvider>
  </React.StrictMode>,
)
