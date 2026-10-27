// The warehouse on a package: fixed. PAYLESSHOPMORE is shown, and there is
// nothing to choose or type.

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { LocationForm } from './PackagePage';

const CHOICES = { default: 'PAYLESSHOPMORE', warehouses: ['PAYLESSHOPMORE'], options: ['PAYLESSHOPMORE'] };

function shipment(extra = {}) {
  return { id: 5, warehouse_location: '', location_choices: CHOICES, ...extra };
}

describe('LocationForm', () => {
  it('shows the warehouse, fixed', () => {
    renderWithProviders(<LocationForm shipment={shipment({ warehouse_location: 'PAYLESSHOPMORE' })} />);

    expect(screen.getByText('PAYLESSHOPMORE')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows it too for a package not received yet', () => {
    renderWithProviders(<LocationForm shipment={shipment()} />);
    expect(screen.getByText('PAYLESSHOPMORE')).toBeInTheDocument();
  });
});
