// Dashboard -> Document review. What matters: the queue lists the jobs, a job
// opens with the reasons and the proposed matches, and every action goes to
// the server with exactly what the person chose (a correction only with a
// reason, only the changed fields; a rejection only with a reason). Invoices
// cannot be picked by somebody who is not an admin.
//
// jsdom reports an English browser, so these read the English texts.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import {
  confirmDocumentJob,
  editDocumentFields,
  getDocumentJob,
  listDocumentJobs,
  rejectDocumentMatch,
  selectDocumentMatch,
} from '../../api/staff';
import DocumentReview from './DocumentReview';

vi.mock('../../api/staff', () => ({
  listDocumentJobs: vi.fn(),
  getDocumentJob: vi.fn(),
  uploadDocumentForReview: vi.fn(),
  searchDocumentCandidates: vi.fn(),
  editDocumentFields: vi.fn(),
  selectDocumentMatch: vi.fn(),
  rejectDocumentMatch: vi.fn(),
  confirmDocumentJob: vi.fn(),
  retryDocumentJob: vi.fn(),
  resolveDocumentJob: vi.fn(),
}));

const ROW = {
  id: 7,
  source: 'email',
  status: 'needs_review',
  original_name: 'invoice.pdf',
  summary: 'A shop invoice.',
  reasons: 2,
  customer_label: '',
  package_label: '',
  auto_linked: false,
  created_at: '2026-10-23T09:00:00Z',
};

const JOB = {
  ...ROW,
  content_type: 'application/pdf',
  source_meta: { from: 'shop@example.com', subject: 'Your order' },
  text: 'Invoice for PLSM-00011',
  extracted: { document_type: 'shop_invoice', shipment_numbers: ['PLSM-00011'], customer_email: '' },
  human_fields: [],
  validation: [],
  review_reasons: [{ code: 'conflict:package', message: 'More than one possible package was found; pick the right one.' }],
  proposals: {
    customer: [],
    package: [
      { id: 11, label: 'PLSM-00011 · TV · Ana', reasons: ['Shipment number PLSM-00011 is on the document'], strong: true },
      { id: 12, label: 'PLSM-00012 · Bike · Ana', reasons: ['Similar'], strong: false },
    ],
    order: [],
    invoice: [{ id: 3, label: 'PLSM20260011 · Sent · PLSM-00011', reasons: ['Invoice number'], strong: true }],
  },
  selected: {},
  selected_labels: {},
  links: { customer: null, package: null, order: null, invoice: null },
  attempts: [{ number: 1, started_at: '2026-10-23T09:00:01Z', ok: true, error: '', requested_by: '' }],
  events: [{ id: 1, action: 'created', actor: '', field: '', before: null, after: null, reason: '', created_at: '2026-10-23T09:00:00Z' }],
  can_link_invoice: false,
  last_error: '',
};

beforeEach(() => {
  listDocumentJobs.mockReset().mockResolvedValue({ results: [ROW], count: 1 });
  getDocumentJob.mockReset().mockResolvedValue(JOB);
  selectDocumentMatch.mockReset().mockResolvedValue({ ...JOB, selected: { package: 11 }, selected_labels: { package: 'PLSM-00011 · TV · Ana' } });
  confirmDocumentJob.mockReset().mockResolvedValue({ ...JOB, status: 'linked' });
  editDocumentFields.mockReset().mockResolvedValue(JOB);
  rejectDocumentMatch.mockReset().mockResolvedValue(JOB);
  // The preview fetches the file; jsdom has no blob URLs, so both are faked.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['%PDF'])) })));
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openJob(user) {
  renderWithProviders(<DocumentReview />);
  await user.click(await screen.findByRole('button', { name: 'Open' }));
  return screen.findByRole('dialog', { name: 'invoice.pdf' });
}

describe('the document review queue', () => {
  it('starts on the jobs that need review', async () => {
    renderWithProviders(<DocumentReview />);
    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument();
    expect(listDocumentJobs).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_review' }));
    expect(screen.getByText('2 reason(s) to check')).toBeInTheDocument();
  });

  it('shows why a person must look, and links the chosen shipment', async () => {
    const user = userEvent.setup();
    const dialog = await openJob(user);

    expect(within(dialog).getByText(/More than one possible package/)).toBeInTheDocument();
    expect(within(dialog).getByText('Your order')).toBeInTheDocument();

    const proposal = within(dialog).getByText('PLSM-00011 · TV · Ana').closest('li');
    await user.click(within(proposal).getByRole('button', { name: 'Use this' }));
    expect(selectDocumentMatch).toHaveBeenCalledWith(7, 'package', 11);

    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'checked the label');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and link' }));
    expect(confirmDocumentJob).toHaveBeenCalledWith(7, 'checked the label');
    expect(await within(dialog).findByText(/The records on the website are updated/)).toBeInTheDocument();
  });

  it('sends a correction only with a reason, and only the changed field', async () => {
    const user = userEvent.setup();
    const dialog = await openJob(user);

    await user.click(within(dialog).getByRole('button', { name: 'Edit fields' }));
    const email = within(dialog).getByRole('textbox', { name: 'Customer e-mail' });
    await user.type(email, 'ana@example.com');
    const save = within(dialog).getByRole('button', { name: 'Save corrections' });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByRole('textbox', { name: 'Reason for the correction' }), 'from the e-mail');
    await user.click(save);
    expect(editDocumentFields).toHaveBeenCalledWith(7, { customer_email: 'ana@example.com' }, 'from the e-mail');
  });

  it('rejects a match only with a reason', async () => {
    const user = userEvent.setup();
    const dialog = await openJob(user);

    const proposal = within(dialog).getByText('PLSM-00012 · Bike · Ana').closest('li');
    await user.click(within(proposal).getByRole('button', { name: 'Wrong' }));
    const reject = within(proposal).getByRole('button', { name: 'Reject match' });
    expect(reject).toBeDisabled();
    await user.type(within(proposal).getByRole('textbox', { name: 'Why is this match wrong?' }), 'other parcel');
    await user.click(reject);
    expect(rejectDocumentMatch).toHaveBeenCalledWith(7, 'package', 12, 'other parcel');
  });

  it('does not let somebody who is not an admin pick an invoice', async () => {
    const user = userEvent.setup();
    const dialog = await openJob(user);

    expect(within(dialog).getByText('Only an admin can link a document to an invoice.')).toBeInTheDocument();
    const invoice = within(dialog).getByText('PLSM20260011 · Sent · PLSM-00011').closest('li');
    expect(within(invoice).queryByRole('button', { name: 'Use this' })).not.toBeInTheDocument();
  });
});

describe('uploading a document to be read', () => {
  it('shows the chosen file, uploads it with the note, and opens the new job', async () => {
    const { uploadDocumentForReview } = await import('../../api/staff');
    uploadDocumentForReview.mockReset().mockResolvedValue(JOB);
    const user = userEvent.setup();
    renderWithProviders(<DocumentReview />);

    expect(await screen.findByText('No file chosen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload and read' })).toBeDisabled();

    const file = new File(['%PDF'], 'factuur.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Upload a document to read'), file);
    expect(screen.getByText('factuur.pdf')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'From the counter');
    await user.click(screen.getByRole('button', { name: 'Upload and read' }));

    expect(uploadDocumentForReview).toHaveBeenCalledWith(file, 'From the counter');
    expect(await screen.findByText('No file chosen')).toBeInTheDocument();
  });

  it('says so when the upload is refused', async () => {
    const { uploadDocumentForReview } = await import('../../api/staff');
    uploadDocumentForReview.mockReset().mockRejectedValue({ fields: { file: ['This kind of file cannot be read.'] } });
    const user = userEvent.setup();
    renderWithProviders(<DocumentReview />);

    await user.upload(
      await screen.findByLabelText('Upload a document to read'),
      new File(['x'], 'scan.png', { type: 'image/png' }),
    );
    await user.click(screen.getByRole('button', { name: 'Upload and read' }));

    expect(await screen.findByText('This kind of file cannot be read.')).toBeInTheDocument();
  });
});
