// The profile's "Two-factor sign-in" card.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { disableTwoFactor, getTwoFactorStatus, newRecoveryCodes } from '../../api/twoFactor';
import { renderWithProviders } from '../../test/utils';
import TwoFactorCard from './TwoFactorCard';

vi.mock('../../api/twoFactor', () => ({
  getTwoFactorStatus: vi.fn(),
  newRecoveryCodes: vi.fn(),
  disableTwoFactor: vi.fn(),
}));

const auth = { user: null, refreshUser: vi.fn().mockResolvedValue(null) };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

beforeEach(() => {
  auth.user = { id: 1, twoFactorMode: 'optional', twoFactorEnabled: true, twoFactorRequired: false };
  getTwoFactorStatus.mockReset().mockResolvedValue({ enabled: true, required: false, recovery_codes_left: 9 });
  newRecoveryCodes.mockReset();
  disableTwoFactor.mockReset();
});

describe('Two-factor card', () => {
  it('is not drawn while the admin has two-factor disabled', () => {
    auth.user = { id: 1, twoFactorMode: 'disabled' };
    renderWithProviders(<TwoFactorCard />);
    expect(screen.queryByText('Two-factor sign-in')).not.toBeInTheDocument();
  });

  it('lets an admin set it up while it is still switched off for the site', async () => {
    auth.user = { id: 1, isAdmin: true, twoFactorMode: 'disabled', twoFactorEnabled: false };
    getTwoFactorStatus.mockResolvedValue({ enabled: false, required: false, recovery_codes_left: 0 });
    renderWithProviders(<TwoFactorCard />);

    expect(screen.getByRole('note')).toHaveTextContent('Set it up on your own account here first');
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('tells the admin when their account is ready to switch it on', async () => {
    auth.user = { id: 1, isAdmin: true, twoFactorMode: 'disabled', twoFactorEnabled: true };
    renderWithProviders(<TwoFactorCard />);
    expect(screen.getByRole('note')).toHaveTextContent('Your account is ready');
  });

  it('offers to turn it on when it is off', async () => {
    auth.user = { id: 1, twoFactorMode: 'optional', twoFactorEnabled: false };
    getTwoFactorStatus.mockResolvedValue({ enabled: false, required: false, recovery_codes_left: 0 });
    renderWithProviders(<TwoFactorCard />);
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('turns it off with the password and a code', async () => {
    const user = userEvent.setup();
    disableTwoFactor.mockResolvedValue({ state: 'off' });
    renderWithProviders(<TwoFactorCard />);

    expect(await screen.findByText(/9 recovery codes left/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await user.type(screen.getByLabelText('Your password'), 'my-password');
    await user.type(screen.getByLabelText('Code from your app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Turn two-factor off' }));

    expect(disableTwoFactor).toHaveBeenCalledWith({ password: 'my-password', code: '123456' });
    expect(await screen.findByText(/Two-factor sign-in is off/)).toBeInTheDocument();
  });

  it('has no Turn off when it is required for the account', async () => {
    getTwoFactorStatus.mockResolvedValue({ enabled: true, required: true, recovery_codes_left: 10 });
    renderWithProviders(<TwoFactorCard />);
    expect(await screen.findByText(/required for your account/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
  });

  it('shows new recovery codes once', async () => {
    const user = userEvent.setup();
    newRecoveryCodes.mockResolvedValue({ recovery_codes: ['abcd-efgh-jkmn'] });
    renderWithProviders(<TwoFactorCard />);

    await user.click(await screen.findByRole('button', { name: 'New recovery codes' }));
    await user.type(screen.getByLabelText('Code from your app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Make new codes' }));

    expect(await screen.findByText('abcd-efgh-jkmn')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I have saved them' }));
    expect(screen.queryByText('abcd-efgh-jkmn')).not.toBeInTheDocument();
  });
});
