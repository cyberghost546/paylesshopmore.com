// The authenticator-app step of signing in, and the guard that sends staff to it.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, API_ERRORS } from '../../api/client';
import { confirmTwoFactor, startTwoFactorSetup, verifyTwoFactor } from '../../api/twoFactor';
import RequireStaff from '../../components/RequireStaff/RequireStaff';
import { renderWithProviders } from '../../test/utils';
import TwoFactorPage from './TwoFactorPage';

vi.mock('../../api/twoFactor', () => ({
  startTwoFactorSetup: vi.fn(),
  confirmTwoFactor: vi.fn(),
  verifyTwoFactor: vi.fn(),
}));

const auth = {
  user: null,
  isChecking: false,
  isAuthenticated: true,
  refreshUser: vi.fn(),
  signOut: vi.fn(),
};
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

// The QR code is drawn by @zxing in the browser; not what is under test here.
vi.mock('@zxing/browser', () => ({
  BrowserQRCodeSvgWriter: class {
    write() {
      return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    }
  },
}));

function renderAt(path = '/two-factor') {
  return renderWithProviders(
    <Routes>
      <Route path="/two-factor" element={<TwoFactorPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireStaff>
            <p>The dashboard</p>
          </RequireStaff>
        }
      />
    </Routes>,
    { route: path },
  );
}

beforeEach(() => {
  auth.user = { id: 1, email: 'kantoor@example.com', isStaff: true, twoFactor: 'code_required' };
  auth.refreshUser.mockReset().mockImplementation(async () => {
    auth.user = { ...auth.user, twoFactor: 'verified' };
    return auth.user;
  });
  verifyTwoFactor.mockReset();
  confirmTwoFactor.mockReset();
  startTwoFactorSetup.mockReset();
});

describe('Two-factor sign-in', () => {
  it('sends a staff member who still needs the code from the dashboard to this page', async () => {
    renderAt('/dashboard');
    expect(await screen.findByText('Code from your app')).toBeInTheDocument();
    expect(screen.queryByText('The dashboard')).not.toBeInTheDocument();
  });

  it('accepts the code and goes on to the dashboard', async () => {
    const user = userEvent.setup();
    verifyTwoFactor.mockResolvedValue({ state: 'verified' });
    renderAt();

    await user.type(await screen.findByLabelText(/Code/), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(verifyTwoFactor).toHaveBeenCalledWith('123456');
    expect(await screen.findByText('The dashboard')).toBeInTheDocument();
  });

  it('says so when the code is wrong', async () => {
    const user = userEvent.setup();
    verifyTwoFactor.mockRejectedValue(new ApiError(API_ERRORS.VALIDATION, {}, 400));
    renderAt();

    await user.type(await screen.findByLabelText(/Code/), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right');
  });

  it('sets up the app, then shows the backup codes once before going on', async () => {
    const user = userEvent.setup();
    auth.user = { ...auth.user, twoFactor: 'setup_required' };
    startTwoFactorSetup.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauth_uri: 'otpauth://totp/PayLesShopMore:kantoor%40example.com?secret=JBSWY3DPEHPK3PXP',
    });
    confirmTwoFactor.mockResolvedValue({ state: 'verified', recovery_codes: ['abcd-efgh-jkmn', 'pqrs-tuvw-xyz2'] });
    renderAt();

    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Code/), '654321');
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(confirmTwoFactor).toHaveBeenCalledWith('654321');
    expect(await screen.findByText('abcd-efgh-jkmn')).toBeInTheDocument();

    const go = screen.getByRole('button', { name: 'Continue' });
    expect(go).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /saved these codes/ }));
    await user.click(go);
    expect(await screen.findByText('The dashboard')).toBeInTheDocument();
  });

  it('runs the setup when somebody turns it on from their profile', async () => {
    auth.user = { ...auth.user, twoFactor: 'off' };
    startTwoFactorSetup.mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/x' });
    renderWithProviders(
      <Routes>
        <Route path="/two-factor" element={<TwoFactorPage />} />
      </Routes>,
      { route: { pathname: '/two-factor', state: { enable: true } } },
    );
    expect(await screen.findByText('Secure your account')).toBeInTheDocument();
    expect(startTwoFactorSetup).toHaveBeenCalled();
  });
});
