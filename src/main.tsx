import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './globals.css'
import App from './App'
import { applyTheme, usePrefs } from './stores/prefs'

// Apply the saved theme before the first paint to avoid a flash.
applyTheme(usePrefs.getState().theme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
