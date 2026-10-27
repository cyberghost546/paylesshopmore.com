// Dashboard -> Security: the admin's two-factor policy.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, API_ERRORS } from '../../api/client';
import { getTwoFactorPolicy, setTwoFactorPolicy } from '../../api/twoFactor';
import { renderWithProviders } from '../../test/utils';
import Security from './Security';

vi.mock('../../api/twoFactor', () => ({
  getTwoFactorPolicy: vi.fn(),
  setTwoFactorPolicy: vi.fn(),
}));

const auth = { user: null, refreshUser: vi.fn().mockResolvedValue(null) };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

function policy(overrides = {}) {
  return {
    mode: 'disabled',
    effective_mode: 'disabled',
    minimum_mode: 'disabled',
    force_disabled: false,
    debug: true,
    you_have_it: true,
    affected: {
      required_admins: { total: 2, set_up: 1, without: [{ id: 7, name: 'Bea Baas', email: 'bea@example.com' }] },
      required_all: { total: 40, set_up: 1, without: [] },
    },
    events: [
      {
        id: 1, kind: 'policy_changed', user: null, actor: { id: 1, name: 'Chris', email: 'c@example.com' },
        detail: { from: 'disabled', to: 'optional' }, created_at: '2026-10-19T09:00:00Z',
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  auth.user = { id: 1, role: 'admin', isAdmin: true };
  getTwoFactorPolicy.mockReset().mockResolvedValue(policy());
  setTwoFactorPolicy.mockReset();
});

describe('Security', () => {
  it('tells office staff who are not admins that it is not for them', async () => {
    auth.user = { id: 2, role: 'office', isAdmin: false };
    renderWithProviders(<Security />);
    expect(await screen.findByText(/Only an admin can change/)).toBeInTheDocument();
    expect(getTwoFactorPolicy).not.toHaveBeenCalled();
  });

  it('shows the status, the four modes, the counts and the history', async () => {
    renderWithProviders(<Security />);
    const status = await screen.findByRole('region', { name: /Two-factor sign-in right now/ });
    expect(within(status).getByText('Disabled')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByText('1 of 2 administrators have it set up.')).toBeInTheDocument();
    expect(screen.getByText('Mode changed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled(); // nothing changed yet
  });

  it('asks for confirmation and the password, then saves', async () => {
    const user = userEvent.setup();
    setTwoFactorPolicy.mockResolvedValue(policy({ mode: 'required_admins', effective_mode: 'required_admins' }));
    renderWithProviders(<Security />);

    await user.click(await screen.findByRole('radio', { name: /Required for administrators/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const dialog = screen.getByRole('dialog', { name: 'Change two-factor sign-in?' });
    expect(within(dialog).getByText(/1 of 2 affected accounts/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Bea Baas/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Your password/), 'secret-password');
    await user.click(within(dialog).getByRole('button', { name: 'Yes, save' }));

    expect(setTwoFactorPolicy).toHaveBeenCalledWith({ mode: 'required_admins', password: 'secret-password' });
    expect(await screen.findByText(/Saved. Two-factor sign-in is now/)).toBeInTheDocument();
  });

  it('says so when the password is wrong', async () => {
    const user = userEvent.setup();
    setTwoFactorPolicy.mockRejectedValue(new ApiError(API_ERRORS.VALIDATION, { password: ['no'] }, 400));
    renderWithProviders(<Security />);

    await user.click(await screen.findByRole('radio', { name: /^Optional/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await user.type(screen.getByLabelText(/Your password/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Yes, save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That password is not right.');
  });

  it('will not let an admin without two-factor make it required', async () => {
    const user = userEvent.setup();
    getTwoFactorPolicy.mockResolvedValue(policy({ you_have_it: false }));
    renderWithProviders(<Security />);

    await user.click(await screen.findByRole('radio', { name: /Required for everyone/ }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getAllByText(/Set up two-factor on your own account first/).length).toBeGreaterThan(0);
  });
});
