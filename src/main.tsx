import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// fonts are bundled so the desktop app looks the same offline
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './index.css'
import App from './App.tsx'
import { startPanelTranslation } from './app/i18n'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// panels and dialogs follow the interface language (dialogs may render outside #root)
startPanelTranslation(document.body)
