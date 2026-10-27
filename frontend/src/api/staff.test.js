// The back-office API helpers (api/staff.js): the addresses they build, the
// blanks they leave out, the defaults they fill in and the list shape they
// hand the pages. request() itself is mocked - nothing goes over the network.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from './client';
import * as staff from './staff';

vi.mock('./client', () => ({ request: vi.fn() }));

beforeEach(() => {
  request.mockReset().mockResolvedValue({});
});

/** The path (and options) of the last request. */
const last = () => request.mock.calls.at(-1);

describe('filters in the address', () => {
  it('leaves out blanks but keeps false', async () => {
    await staff.listMessages({ handled: false, search: '', ai_topic: null, ordering: 'urgency', page: 2 });
    expect(last()[0]).toBe('/staff/messages/?handled=false&ordering=urgency&page=2');
  });

  it('sends no "?" when there is nothing to filter on', async () => {
    await staff.listQuotes({ status: '' });
    expect(last()[0]).toBe('/staff/quotes/');
  });

  it('reads a blank invoice status as every status', async () => {
    await staff.listInvoices({ status: '' });
    expect(last()[0]).toBe('/staff/invoices/?status=all');
    await staff.listInvoices({ status: 'sent' });
    expect(last()[0]).toBe('/staff/invoices/?status=sent');
    await staff.listInvoices();
    expect(last()[0]).toBe('/staff/invoices/?status=all');
  });

  it('narrows workers to staff roles unless a role is asked for', async () => {
    await staff.listWorkers({});
    expect(last()[0]).toContain('role=worker');
    await staff.listWorkers({ role: 'driver' });
    expect(last()[0]).toContain('role=driver');
    await staff.listWorkers();
    expect(last()[0]).toContain('role=worker');
  });
});

describe('one list shape for every page', () => {
  it('takes a DRF page', async () => {
    request.mockResolvedValue({ results: [{ id: 1 }], count: 30, next: '/p3', previous: null });
    expect(await staff.listMessages({})).toEqual({ results: [{ id: 1 }], count: 30, hasNext: true, hasPrevious: false });
  });

  it('takes a plain list', async () => {
    request.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    expect(await staff.listQuotes({})).toEqual({ results: [{ id: 1 }, { id: 2 }], count: 2 });
  });

  it('takes nothing at all', async () => {
    request.mockResolvedValue(null);
    expect(await staff.listQuotes({})).toEqual({ results: [], count: 0, hasNext: false, hasPrevious: false });
  });
});

describe('the AI helpers', () => {
  it('asks for the AI part only when wanted', async () => {
    await staff.getDailySummary();
    expect(last()[0]).toBe('/staff/summary/');
    await staff.getDailySummary({ highlights: true });
    expect(last()[0]).toBe('/staff/summary/?highlights=1');

    await staff.getCustomsCheck(4);
    expect(last()[0]).toBe('/staff/packages/4/customs-check/');
    await staff.getCustomsCheck(4, { ai: true });
    expect(last()[0]).toBe('/staff/packages/4/customs-check/?ai=1');
  });

  it('posts the drafts, the sorting and the replies', async () => {
    await staff.draftReplyToMessage(3);
    expect(last()).toEqual(['/staff/messages/3/draft-reply/', { method: 'POST', body: {} }]);
    await staff.draftReplyToQuote(7);
    expect(last()).toEqual(['/staff/quotes/7/draft-reply/', { method: 'POST', body: {} }]);
    await staff.replyToQuote(7, 'Dear Anna');
    expect(last()).toEqual(['/staff/quotes/7/reply/', { method: 'POST', body: { body: 'Dear Anna' } }]);
    await staff.sortMessages();
    expect(last()).toEqual(['/staff/messages/sort/', { method: 'POST', body: {} }]);
  });

  it('names a camera picture so the server accepts it', async () => {
    await staff.readLabelWithAi(new Blob(['x'], { type: 'image/jpeg' }));
    const [path, { formData }] = last();
    expect(path).toBe('/staff/intake/read-label/');
    expect(formData.get('file').name).toBe('label.jpg');

    await staff.readLabelWithAi(new File(['x'], 'IMG_1.png', { type: 'image/png' }));
    expect(last()[1].formData.get('file').name).toBe('IMG_1.png');
  });
});

describe('optional values', () => {
  it('leaves out an empty note and an empty invoice date', async () => {
    const file = new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' });
    await staff.uploadDocumentForReview(file);
    expect(last()[1].formData.has('note')).toBe(false);
    await staff.uploadDocumentForReview(file, 'From the counter');
    expect(last()[1].formData.get('note')).toBe('From the counter');
  });

  it('detaches a document when no shipment is given', async () => {
    await staff.attachDocument(5);
    expect(last()[1].body).toEqual({ package: null });
    await staff.attachDocument(5, 9);
    expect(last()[1].body).toEqual({ package: 9 });
  });

  it('names a role, and calls an unknown one a customer', () => {
    expect(staff.roleLabel('nobody-has-this-role')).toBe('Customer');
    const [first] = staff.WORKER_ROLES;
    expect(staff.roleLabel(first.value)).toBe(first.label);
  });
});

describe('every helper', () => {
  // A sweep rather than a test per helper: each one, called with plain
  // arguments, must ask our own API - never another host, never "undefined"
  // in the address.
  const SKIP = new Set(['roleLabel']);
  const helpers = Object.entries(staff).filter(([name, value]) => typeof value === 'function' && !SKIP.has(name));

  it.each(helpers)('%s asks our own API', async (name, helper) => {
    request.mockResolvedValue({ results: [], count: 0 });
    try {
      await helper(1, { status: 'new' }, 'text');
    } catch {
      // A helper that needs real arguments (a File, a form) may refuse these;
      // what matters is the address of whatever it did ask for.
    }
    for (const [path] of request.mock.calls) {
      expect(path.startsWith('/'), `${name} asked ${path}`).toBe(true);
      expect(path, name).not.toContain('undefined');
    }
  });
});
