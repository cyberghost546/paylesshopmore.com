// submitBooking sends JSON without screenshots and one multipart form with
// them, so the booking, its stores and their screenshots are saved together.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachmentUrl, submitBooking } from './booking';

afterEach(() => vi.restoreAllMocks());

function stubFetch() {
  document.cookie = 'csrftoken=test-token';
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
}

const ORDERS = [
  { shop: 3, description: 'Laptop' },
  { shop: null, shop_name: 'Coolblue', description: 'Headphones' },
];

describe('submitBooking', () => {
  it('sends JSON, stores included, when there are no screenshots', async () => {
    const fetch = stubFetch();
    await submitBooking({ quantity: null, value_eur: '45' }, ORDERS, [null, null]);

    const [, options] = fetch.mock.calls.at(-1);
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({ quantity: null, value_eur: '45', orders: ORDERS });
  });

  it('sends one multipart form with each screenshot next to its store', async () => {
    const fetch = stubFetch();
    const shot = new File(['png'], 'coolblue.png', { type: 'image/png' });
    await submitBooking({ insured: false, quantity: null, value_eur: '45' }, ORDERS, [null, shot]);

    const [url, options] = fetch.mock.calls.at(-1);
    expect(url).toBe('/api/bookings/');
    const body = options.body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('insured')).toBe('false');
    expect(body.get('value_eur')).toBe('45');
    // Empty values are left out, not sent as the text "null".
    expect(body.has('quantity')).toBe(false);
    expect(JSON.parse(body.get('orders'))).toEqual(ORDERS);
    // Store 1 (counting from 0) has the screenshot; store 0 has none.
    expect(body.has('order_0_screenshot')).toBe(false);
    expect(body.get('order_1_screenshot').name).toBe('coolblue.png');
    // The browser sets the multipart header itself, with the boundary.
    expect(options.headers['Content-Type']).toBeUndefined();
  });
});

describe('attachmentUrl', () => {
  it('turns the server path into an address the browser can load', () => {
    expect(attachmentUrl('/api/bookings/mine/3/attachments/9/')).toBe(
      '/api/bookings/mine/3/attachments/9/',
    );
  });
});
