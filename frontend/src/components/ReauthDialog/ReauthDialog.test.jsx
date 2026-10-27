// "Confirm it's you": api/client.js and the box work together. A request the
// server refuses with reauth_required shows the box, and is sent again once
// the password is confirmed.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ERRORS, request } from '../../api/client';
import { renderWithProviders } from '../../test/utils';
import ReauthDialog from './ReauthDialog';

function answer(status, body) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

let roleCalls = 0;

beforeEach(() => {
  roleCalls = 0;
  document.cookie = 'csrftoken=test-token';
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (String(url).includes('/auth/reauthenticate/')) return answer(200, { ok: true });
      roleCalls += 1;
      // First time: "confirm it's you". After that: done.
      return roleCalls === 1
        ? answer(403, { detail: 'Please confirm.', code: 'reauth_required', needs_code: false })
        : answer(200, { id: 5, role: 'driver' });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Confirm it's you", () => {
  it('asks for the password, then repeats the request by itself', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReauthDialog />);

    const pending = request('/staff/customers/5/role/', { method: 'POST', body: { role: 'driver' } });

    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    expect(dialog).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'my-password');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await expect(pending).resolves.toEqual({ id: 5, role: 'driver' });
    expect(roleCalls).toBe(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fails the request when the box is cancelled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReauthDialog />);

    const pending = request('/staff/customers/5/role/', { method: 'POST', body: { role: 'driver' } });
    // Waited on before the click, so the rejection is never "unhandled"
    // (it can land before the click's own await returns).
    const failed = expect(pending).rejects.toMatchObject({ code: API_ERRORS.REAUTH_CANCELLED });
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await failed;
    expect(roleCalls).toBe(1);
  });
});
