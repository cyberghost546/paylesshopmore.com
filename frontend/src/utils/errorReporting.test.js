// Error reports from the browser (utils/errorReporting.js). What matters: a
// report goes to /api/client-errors/ without cookies, the same message is sent
// only once, there is a cap per page visit, and noise is ignored.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportError, resetErrorReportingForTests } from './errorReporting';

beforeEach(() => {
  resetErrorReportingForTests();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reportError', () => {
  it('sends the message and the stack, without cookies', () => {
    const error = new Error('x is not a function');
    reportError(error, 'boundary');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/client-errors/');
    expect(options.credentials).toBe('omit');
    const body = JSON.parse(options.body);
    expect(body.message).toBe('x is not a function');
    expect(body.source).toBe('boundary');
    expect(body.stack).toContain('x is not a function');
  });

  it('sends the same message only once', () => {
    reportError(new Error('same'));
    reportError(new Error('same'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops after ten reports on one page visit', () => {
    for (let index = 0; index < 15; index += 1) reportError(new Error(`error ${index}`));
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('ignores browser noise and empty errors', () => {
    reportError(new Error('ResizeObserver loop completed with undelivered notifications.'));
    reportError(undefined);
    reportError('');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never throws, even when sending fails', () => {
    fetch.mockImplementation(() => {
      throw new Error('network down');
    });
    expect(() => reportError(new Error('boom'))).not.toThrow();
  });
});
