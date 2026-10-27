// ENTRY POINT: index.html loads this file, and this file boots React.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// Global stylesheet, imported here so it applies to the whole document once.
import './index.css';

import { LanguageProvider } from './i18n/LanguageContext.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import LanguageSync from './auth/LanguageSync.jsx';
import App from './App.jsx';
import { installErrorReporting } from './utils/errorReporting';

// Sends JavaScript errors that happen in visitors' browsers to our server,
// so we hear about a crashing page (see utils/errorReporting.js).
installErrorReporting();

// Grabs the empty <div id="root"> from index.html and hands it over to React.
createRoot(document.getElementById('root')).render(
  // StrictMode is a dev-only helper that double-renders to surface bugs early.
  <StrictMode>
    {/* BrowserRouter supplies the routing context (current URL, navigate, etc). */}
    {/* REQUIRED: a NavLink/Link/Routes with no Router above it throws on render. */}
    {/* A throw during render kills the whole tree, which is a blank white page. */}
    <BrowserRouter>
      {/* Supplies the active language and t() to the whole tree. */}
      <LanguageProvider>
        {/* Knows who is signed in; the route guard and header read from it. */}
        <AuthProvider>
          {/* Tells the account which language the site is read in, for e-mails. */}
          <LanguageSync />
          <App />
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  </StrictMode>,
);
