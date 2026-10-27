// A damage report on the package's own page: closed there with Resolve,
// since the warehouse no longer has a separate Damaged list.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDamageReport } from '../../api/warehouse';
import { renderWithProviders } from '../../test/utils';
import DamageReport from './DamageReport';

vi.mock('../../api/warehouse', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveDamageReport: vi.fn(),
}));

const OPEN = {
  id: 3,
  damage_type: 'crushed',
  description: 'Corner pushed in',
  resolution_status: 'open',
  photos: [],
  package: { id: 7, tracking_number: 'PLSM-0007', customer: 'Ana Martis' },
  worker: { name: 'Wim Vloer' },
  time: '09:12',
  date: '2026-10-12',
};

beforeEach(() => {
  window.localStorage.setItem('plsm.language', 'en');
  vi.mocked(resolveDamageReport).mockReset();
});

describe('a damage report on the package page', () => {
  it('is resolved with a note of what was done', async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    vi.mocked(resolveDamageReport).mockResolvedValue({ ...OPEN, resolution_status: 'resolved' });
    renderWithProviders(<DamageReport report={OPEN} onResolved={onResolved} showPackage={false} />);

    // On its own page the package is not named again.
    expect(screen.queryByText('PLSM-0007')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Resolve/ }));
    await user.type(screen.getByRole('textbox'), 'Repacked in a new box');
    await user.click(screen.getByRole('button', { name: /resolved/i }));

    expect(resolveDamageReport).toHaveBeenCalledWith(3, 'Repacked in a new box');
    expect(onResolved).toHaveBeenCalled();
  });
});
