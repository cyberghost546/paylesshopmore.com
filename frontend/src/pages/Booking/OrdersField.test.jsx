// "Uw bestellingen" on the booking form: one card per store, with the store
// from the site's list (or another one by name), what was bought, and an
// optional screenshot. Plus the rules in orders.js the form checks with.

import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../../i18n/translations';
import { listShops } from '../../api/shops';
import OrdersField from './OrdersField';
import { newRow, toPayload, validateOrders } from './orders';

vi.mock('../../api/shops', () => ({ listShops: vi.fn() }));

const words = translations.en;
const t = (key) => key.split('.').reduce((value, part) => value?.[part], words) ?? key;

/** The field with real state around it, like the booking form gives it. */
function Harness({ onRows = () => {}, errors = {} }) {
  const [rows, setRows] = useState(() => [newRow()]);
  return (
    <OrdersField
      rows={rows}
      onChange={(next) => {
        setRows(next);
        onRows(next);
      }}
      errors={errors}
      serverError={null}
      t={t}
      language="en"
    />
  );
}

const png = (name = 'order.png') => new File([new Uint8Array(3000)], name, { type: 'image/png' });

beforeEach(() => {
  listShops.mockReset();
  listShops.mockResolvedValue([
    { id: 3, name: 'bol.com' },
    { id: 7, name: 'IKEA' },
  ]);
});

describe('the store cards', () => {
  it('offers the stores from the site, and another store by name', async () => {
    const user = userEvent.setup();
    const onRows = vi.fn();
    render(<Harness onRows={onRows} />);

    const select = screen.getByLabelText('Store');
    await waitFor(() => expect(within(select).getByRole('option', { name: 'IKEA' })).toBeInTheDocument());
    expect(within(select).getByRole('option', { name: 'Another store' })).toBeInTheDocument();

    await user.selectOptions(select, 'other');
    await user.type(screen.getByLabelText('Name of the store'), 'Coolblue');
    await user.type(screen.getByLabelText('What did you order?'), 'Headphones');

    expect(toPayload(onRows.mock.calls.at(-1)[0])).toEqual([
      { shop: null, shop_name: 'Coolblue', description: 'Headphones' },
    ]);
  });

  it('adds and removes stores', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '+ Add another store' }));
    await user.click(screen.getByRole('button', { name: '+ Add another store' }));
    expect(screen.getByText('Store 3')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(screen.queryByText('Store 3')).toBeNull();
    expect(screen.getByText('Store 2')).toBeInTheDocument();
  });

  it('takes a screenshot per store and can remove it again', async () => {
    const user = userEvent.setup();
    const onRows = vi.fn();
    render(<Harness onRows={onRows} />);

    await user.upload(screen.getByLabelText('Screenshot for store 1'), png('bol-order.png'));
    expect(screen.getByText('bol-order.png')).toBeInTheDocument();
    expect(onRows.mock.calls.at(-1)[0][0].file.name).toBe('bol-order.png');

    await user.click(screen.getByRole('button', { name: 'Remove bol-order.png' }));
    expect(screen.queryByText('bol-order.png')).toBeNull();
    expect(screen.getByText('Add a screenshot')).toBeInTheDocument();
  });

  it('refuses a file that is not a picture or PDF', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness />);

    await user.upload(screen.getByLabelText('Screenshot for store 1'), new File(['MZ'], 'setup.exe'));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'setup.exe cannot be added: only PNG, JPG, WebP or PDF.',
    );
    expect(screen.queryByText('setup.exe', { selector: 'span' })).toBeNull();
  });

  it('still works when the store list cannot be loaded', async () => {
    listShops.mockRejectedValue(new Error('offline'));
    render(<Harness />);

    const select = screen.getByLabelText('Store');
    await waitFor(() => expect(listShops).toHaveBeenCalled());
    expect(within(select).getByRole('option', { name: 'Another store' })).toBeInTheDocument();
  });
});

describe('the rules', () => {
  it('needs a store and what was bought on every row', () => {
    const empty = { ...newRow() };
    const other = { ...newRow(), shop: 'other', description: 'Shoes' };
    const fine = { ...newRow(), shop: '3', description: 'Laptop' };

    expect(validateOrders([empty, other, fine])).toEqual({
      [empty.key]: { shop: 'booking.orders.errors.shop', description: 'booking.orders.errors.description' },
      [other.key]: { shopName: 'booking.orders.errors.shopName' },
    });
  });

  it.each(['nl', 'en', 'pap'])('has all its words in %s', (language) => {
    const keys = (value) => Object.keys(value).sort();
    expect(keys(translations[language].booking.orders)).toEqual(keys(words.booking.orders));
    expect(keys(translations[language].booking.orders.errors)).toEqual(
      keys(words.booking.orders.errors),
    );
  });
});
