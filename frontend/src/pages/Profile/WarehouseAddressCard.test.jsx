// "Your shipping address" on the profile: the warehouse address with the
// account holder's own name, a reminder to use it, and
// copy buttons that work.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import WarehouseAddressCard from './WarehouseAddressCard';

const KLAAS = { firstName: 'Klaas', lastName: 'Klant' };

// userEvent.setup() gives the page a pretend clipboard; the tests read it back.
beforeEach(() => {
  window.localStorage.setItem('plsm.language', 'en');
});

describe('WarehouseAddressCard', () => {
  it('shows the full name, without a customer number', () => {
    renderWithProviders(<WarehouseAddressCard {...KLAAS} />);

    expect(screen.getByText('Klaas Klant')).toBeInTheDocument();
    expect(screen.queryByText(/PLSM-C/)).toBeNull();
    // Our name only as the company, for a checkout that asks for one.
    expect(screen.getByText('Pay less Shop More')).toBeInTheDocument();
    expect(screen.getByText('Hertzstraat 10')).toBeInTheDocument();
    expect(screen.getByText('2652 XX')).toBeInTheDocument();
    expect(screen.getByText('Berkel en Rodenrijs')).toBeInTheDocument();
  });

  it('reminds the customer to use it for every order', () => {
    renderWithProviders(<WarehouseAddressCard {...KLAAS} />);
    expect(screen.getByRole('note')).toHaveTextContent('use this address as the delivery address for every order');
  });

  it('copies one line', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WarehouseAddressCard {...KLAAS} />);

    await user.click(screen.getByRole('button', { name: /^Copy: Full name.* Klaas Klant$/ }));
    expect(await navigator.clipboard.readText()).toBe('Klaas Klant');
  });

  it('copies the whole address as on an envelope', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WarehouseAddressCard {...KLAAS} />);

    await user.click(screen.getByRole('button', { name: 'Copy the whole address' }));
    expect(await navigator.clipboard.readText()).toBe(
      ['Klaas Klant', 'Pay less Shop More', 'Hertzstraat 10', '2652 XX Berkel en Rodenrijs', 'Netherlands'].join(
        '\n',
      ),
    );
    expect(await screen.findByRole('button', { name: 'Address copied!' })).toBeInTheDocument();
  });

  it('says what goes there when the account has no name yet', () => {
    renderWithProviders(<WarehouseAddressCard firstName="" lastName="" />);
    expect(screen.getByText('Your first name Your last name')).toBeInTheDocument();
  });
});
