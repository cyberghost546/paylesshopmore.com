// Dashboard -> System (admins). What matters: a failed backup and missing
// Sentry are shown as needing attention, with the reason; a non-admin is told
// the page is not for them and nothing is fetched.

import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { getSystemStatus } from '../../api/staff';
import SystemStatus from './SystemStatus';

vi.mock('../../api/staff', () => ({ getSystemStatus: vi.fn() }));

const auth = { user: { id: 1, isAdmin: true } };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

const STATUS = {
  backups: {
    destination: 'bucket',
    keep_days: 30,
    last_success_at: null,
    last_success_too_old: true,
    recent: [
      {
        id: 2,
        started_at: '2026-10-23T03:00:00Z',
        finished_at: '2026-10-23T03:00:05Z',
        status: 'failed',
        size_bytes: null,
        pruned: 0,
        error: 'pg_dump failed: server version mismatch',
      },
    ],
  },
  error_monitoring: { sentry: false },
  email: { ready: true },
};

beforeEach(() => {
  auth.user = { id: 1, isAdmin: true };
  getSystemStatus.mockReset().mockResolvedValue(STATUS);
});

describe('the System page', () => {
  it('shows what needs attention, with the reason', async () => {
    renderWithProviders(<SystemStatus />);

    expect(await screen.findByText('pg_dump failed: server version mismatch')).toBeInTheDocument();
    expect(screen.getByText(/none has worked yet/)).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText(/Sentry is off/)).toBeInTheDocument();
    expect(screen.getByText(/The site can send e-mail/)).toBeInTheDocument();
  });

  it('tells a non-admin it is not for them', () => {
    auth.user = { id: 2, isAdmin: false };
    renderWithProviders(<SystemStatus />);

    expect(screen.getByText('Only an admin can open this page.')).toBeInTheDocument();
    expect(getSystemStatus).not.toHaveBeenCalled();
  });
});
