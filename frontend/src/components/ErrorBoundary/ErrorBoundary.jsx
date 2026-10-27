// src/components/ErrorBoundary/ErrorBoundary.jsx
import { Component } from 'react';
import ConnectionError from '../ConnectionError/ConnectionError';
import { reportError } from '../../utils/errorReporting';

/**
 * Catches render-time failures below it — most usefully a lazy() chunk that
 * could not be downloaded, which throws rather than suspending. Without this,
 * losing connection mid-navigation blanks the whole page.
 *
 * Has to be a class: there is no hook equivalent of componentDidCatch.
 */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('Render failed', error, info);
    // Tell our server, so the office hears about a page that fails to draw
    // (utils/errorReporting.js). A chunk that failed to download because the
    // visitor went offline is not a bug in the site, so that one is skipped.
    if (!/dynamically imported module|Loading chunk|Importing a module script failed/i.test(String(error?.message))) {
      reportError(error, 'boundary');
    }
  }

  handleRetry = () => {
    // A missing chunk cannot be re-imported — the module is already cached as
    // failed — so a reload is the only reliable recovery.
    window.location.reload();
  };

  render() {
    if (this.state.failed) {
      return <ConnectionError onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}
