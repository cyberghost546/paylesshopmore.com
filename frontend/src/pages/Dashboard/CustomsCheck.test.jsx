// Dashboard -> Packages -> "Customs check" under a row: the verdict and the
// problems from the rules, then the AI's notes. The server is mocked.

import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { getCustomsCheck } from '../../api/staff';
import CustomsCheck from './CustomsCheck';

vi.mock('../../api/staff', async (importOriginal) => ({
  ...(await importOriginal()),
  getCustomsCheck: vi.fn(),
}));

const RESULT = {
  verdict: 'missing',
  issues: [
    { code: 'no_value', level: 'block', message: 'No declared value.', params: {} },
    {
      code: 'emigration_papers',
      level: 'block',
      message: 'Booked as emigration...',
      params: { id_missing: false, deregistration_missing: true },
    },
    {
      code: 'value_mismatch',
      level: 'warn',
      message: '...',
      params: { declared: '200.00', invoices: '120.00' },
    },
    { code: 'something_new', level: 'warn', message: 'A rule the page has no words for yet.', params: {} },
  ],
  declared_eur: '200.00',
  invoices_eur: '120.00',
  documents: { read: 2, unread: 1, prealert_files: 0 },
};

beforeEach(() => {
  getCustomsCheck.mockReset();
});

describe('CustomsCheck', () => {
  it('shows the verdict, each problem in words, and the AI notes', async () => {
    getCustomsCheck.mockImplementation((id, { ai } = {}) =>
      Promise.resolve(ai ? { ...RESULT, ai_notes: '- The invoice is for a laptop, declared as clothes.' } : RESULT),
    );
    renderWithProviders(<CustomsCheck packageId={4} />);

    expect(await screen.findByText('Not ready for customs')).toBeInTheDocument();
    expect(screen.getByText(/No declared value\. Customs calculates/)).toBeInTheDocument();
    expect(screen.getByText(/something is missing: proof of deregistration\./)).toBeInTheDocument();
    expect(screen.getByText(/Declared value EUR 200.00, but the invoices that were read add up to EUR 120.00/)).toBeInTheDocument();
    // A rule the page has no translation for yet: the server's own words.
    expect(screen.getByText('A rule the page has no words for yet.')).toBeInTheDocument();
    expect(screen.getByText('2 read, 1 not read, 0 from pre-alerts')).toBeInTheDocument();
    expect(await screen.findByText('The invoice is for a laptop, declared as clothes.')).toBeInTheDocument();
    expect(getCustomsCheck).toHaveBeenCalledWith(4);
    expect(getCustomsCheck).toHaveBeenCalledWith(4, { ai: true });
  });

  it('says the paperwork is complete, without AI notes when the AI is off', async () => {
    getCustomsCheck.mockResolvedValue({ ...RESULT, verdict: 'ok', issues: [], ai_notes: '' });
    renderWithProviders(<CustomsCheck packageId={4} />);

    expect(await screen.findByText('Paperwork complete')).toBeInTheDocument();
    await vi.waitFor(() => expect(getCustomsCheck).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Do the documents match?')).not.toBeInTheDocument();
  });
});
