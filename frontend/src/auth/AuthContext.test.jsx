// Who the app thinks is signed in.
//
// This context decides whether the route guards let someone through, so the
// cases that matter are the ones where it could be wrong: before the first
// answer has come back, when nobody is signed in, and after a sign-out that
// the server refused.

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthContext';
import { useAuth } from './useAuth';
import { getProfile } from '../api/profile';
import { request } from '../api/client';
import { signIn as apiSignIn, signOut as apiSignOut } from '../api/auth';

vi.mock('../api/profile', () => ({ getProfile: vi.fn() }));
vi.mock('../api/auth', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
}));

const ANA = { id: 1, firstName: 'Ana', email: 'ana@example.com', isStaff: false };

/**
 * A request the server refuses on identity, made through the real client so
 * the announcement travels the path it does in the app rather than being
 * fired by hand from the test.
 */
function refusedRequest() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status: 403,
    json: async () => ({ detail: 'This area is for staff accounts only.' }),
  });

  return request('/staff/quotes/');
}

/** Renders the context's state as text, so the tests can read it. */
function Probe() {
  const { user, isAuthenticated, isChecking, signIn, signOut } = useAuth();

  return (
    <div>
      <p data-testid="state">
        {isChecking ? 'checking' : isAuthenticated ? 'signed-in' : 'signed-out'}
      </p>
      <p data-testid="name">{user?.firstName ?? ''}</p>
      <p data-testid="staff">{user?.isStaff ? 'staff' : 'not-staff'}</p>
      <button onClick={() => signIn({ email: 'ana@example.com', password: 'x' })}>
        sign in
      </button>
      <button onClick={() => signOut()}>sign out</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    getProfile.mockReset();
    apiSignIn.mockReset();
    apiSignOut.mockReset();
  });

  it('reports "checking" until the first profile request answers', async () => {
    let resolveProfile;
    getProfile.mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      }),
    );

    renderProbe();

    // The whole reason this state exists: without it the route guard bounces
    // a signed-in visitor to the login page on every page refresh, before the
    // session has had a chance to be confirmed.
    expect(screen.getByTestId('state')).toHaveTextContent('checking');

    resolveProfile(ANA);
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('signed-in'),
    );
  });

  it('treats a rejected profile request as signed out, not as an error', async () => {
    // A 403 here only means nobody is signed in. It must leave the app usable.
    getProfile.mockRejectedValue(new Error('UNAUTHENTICATED'));

    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('signed-out'),
    );
    expect(screen.getByTestId('name')).toHaveTextContent('');
  });

  it('re-reads the profile after signing in rather than trusting the response', async () => {
    getProfile.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('signed-out'),
    );

    apiSignIn.mockResolvedValue({ id: 1, first_name: 'Ana' });
    getProfile.mockResolvedValue(ANA);

    await userEvent.click(screen.getByRole('button', { name: 'sign in' }));

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('signed-in'),
    );
    // One mapper builds the user object, so the shape is the same everywhere.
    expect(screen.getByTestId('name')).toHaveTextContent('Ana');
    expect(getProfile).toHaveBeenCalledTimes(2);
  });

  it('signs out locally even when the request to sign out fails', async () => {
    getProfile.mockResolvedValue(ANA);
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('signed-in'),
    );

    apiSignOut.mockRejectedValue(new Error('UNAVAILABLE'));
    await userEvent.click(screen.getByRole('button', { name: 'sign out' }));

    // The visitor asked to be logged out. Leaving the interface signed in
    // because the network failed is the worse of the two failures, especially
    // on a shared machine.
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('signed-out'),
    );
  });

  it('notices when the server stops accepting the session', async () => {
    getProfile.mockResolvedValue(ANA);
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('signed-in'),
    );

    // The session has ended somewhere between page loads. The next request
    // any page makes is refused.
    getProfile.mockRejectedValue(new Error('UNAUTHENTICATED'));
    await expect(refusedRequest()).rejects.toThrow();

    // Before this existed, the dashboard answered an expired session with
    // "could not connect" and a retry button that could never work.
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('signed-out'),
    );
  });

  it('notices when the account is still valid but no longer staff', async () => {
    getProfile.mockResolvedValue({ ...ANA, isStaff: true });
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId('staff')).toHaveTextContent('staff'),
    );

    // Another admin took the role away while this dashboard was open. The
    // profile still reads; it just says something different now.
    getProfile.mockResolvedValue({ ...ANA, isStaff: false });
    await expect(refusedRequest()).rejects.toThrow();

    await waitFor(() =>
      expect(screen.getByTestId('staff')).toHaveTextContent('not-staff'),
    );
    // Still signed in: they are a customer, and sending them to a login form
    // would be a dead end.
    expect(screen.getByTestId('state')).toHaveTextContent('signed-in');
  });

  it('checks once when several tables are refused at the same time', async () => {
    getProfile.mockResolvedValue(ANA);
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('signed-in'),
    );
    getProfile.mockClear();

    // A dashboard page fetches its list, its counts and its filters together.
    await Promise.allSettled([
      refusedRequest(),
      refusedRequest(),
      refusedRequest(),
    ]);

    await waitFor(() => expect(getProfile).toHaveBeenCalled());
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it('refuses to be used outside the provider', () => {
    // Rendering a component that reads the context with no provider above it
    // is a wiring mistake, and it should say so rather than quietly behaving
    // as though nobody is signed in.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow(/AuthProvider|useAuth/);

    quiet.mockRestore();
  });
});

// A warehouse code sign-in on a shared floor device ends after so long with
// nobody doing anything. The server enforces it; these are about the screen
// following, so the next worker is never shown as - or working as - the last
// one, and about the app not keeping the session awake by itself.
describe('AuthProvider on a shared floor device', () => {
  const FLOOR_SESSION = { ...ANA, isWarehouse: true, sessionIdleSeconds: 60 };

  /** An answer from the server, through the real client. */
  async function serverAnswers({ background = false } = {}) {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    await request('/staff/warehouse/shipments/board/', { background });
    const headers = fetch.mock.calls[0][1].headers;
    fetch.mockRestore();
    return headers;
  }

  async function wait(ms) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    getProfile.mockReset();
    apiSignOut.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function signedInAsFloor(profile = FLOOR_SESSION) {
    getProfile.mockResolvedValueOnce(profile);
    renderProbe();
    await serverAnswers();
    await wait(0);
    expect(screen.getByTestId('state')).toHaveTextContent('signed-in');
  }

  /** What the server says when it is finally asked. */
  function serverSays(answer) {
    if (answer === 'over') getProfile.mockRejectedValueOnce(new Error('403'));
    else getProfile.mockResolvedValueOnce(FLOOR_SESSION);
  }

  it('goes back to the login form once the limit passes and the server agrees', async () => {
    await signedInAsFloor();
    serverSays('over');

    await wait(55_000);
    expect(screen.getByTestId('state')).toHaveTextContent('signed-in');
    // Not asked before the limit: nothing to ask about.
    expect(getProfile).toHaveBeenCalledTimes(1);

    await wait(10_000);
    expect(screen.getByTestId('state')).toHaveTextContent('signed-out');
    // Asked as a background request, which the server does not count as
    // somebody working - so asking cannot itself keep the session awake.
    expect(getProfile).toHaveBeenLastCalledWith({ background: true });
  });

  it('counts down again when the session is still in use elsewhere', async () => {
    await signedInAsFloor();
    serverSays('still in use'); // another tab, say

    await wait(65_000);
    expect(screen.getByTestId('state')).toHaveTextContent('signed-in');
    expect(apiSignOut).not.toHaveBeenCalled();

    serverSays('over');
    await wait(65_000);
    expect(screen.getByTestId('state')).toHaveTextContent('signed-out');
  });

  it('starts again from every answer to something somebody did', async () => {
    await signedInAsFloor();

    await wait(50_000);
    await serverAnswers();
    await wait(50_000);
    expect(screen.getByTestId('state')).toHaveTextContent('signed-in');
    expect(getProfile).toHaveBeenCalledTimes(1);

    serverSays('over');
    await wait(15_000);
    expect(screen.getByTestId('state')).toHaveTextContent('signed-out');
  });

  it('does not count a page refreshing itself as somebody working', async () => {
    await signedInAsFloor();
    serverSays('over');

    await wait(50_000);
    const headers = await serverAnswers({ background: true });
    // Marked, so the server does not count it either.
    expect(headers['X-Background-Refresh']).toBe('1');

    await wait(15_000);
    expect(screen.getByTestId('state')).toHaveTextContent('signed-out');
  });

  it('marks nothing else as background', async () => {
    expect((await serverAnswers())['X-Background-Refresh']).toBeUndefined();
  });

  it('looks again the moment a sleeping screen wakes', async () => {
    await signedInAsFloor();
    serverSays('over');

    // The phone slept: the clock moved, but no timer ran.
    vi.setSystemTime(Date.now() + 2 * 60_000);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.getByTestId('state')).toHaveTextContent('signed-out');
  });

  it('leaves a session without an idle limit alone', async () => {
    await signedInAsFloor({ ...ANA, sessionIdleSeconds: null });

    await wait(24 * 60 * 60_000);

    expect(screen.getByTestId('state')).toHaveTextContent('signed-in');
    expect(getProfile).toHaveBeenCalledTimes(1);
  });
});
