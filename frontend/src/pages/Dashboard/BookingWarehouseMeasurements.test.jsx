// The warehouse's measurements on a booking in the office dashboard.

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import BookingWarehouseMeasurements from './BookingWarehouseMeasurements';
import { warehouseSummary } from './bookingMeasurements';

const SHEET = {
  id: 41,
  label: 'IN-7',
  status: 'released',
  freight: 'sea',
  created_at: '2026-10-13T09:00:00Z',
  released_at: '2026-10-13T10:00:00Z',
  created_by: 'Wim Magazijn',
  lines: [
    { quantity: 2, packaging: 'Doos', length_cm: '60.0', width_cm: '40.0', height_cm: '40.0', weight_kg: '12.50', complete: true, note: '' },
    { quantity: 1, packaging: 'Pallet', length_cm: '120.0', width_cm: null, height_cm: null, weight_kg: null, complete: false, note: '' },
  ],
  totals: { colli: '3', volume_m3: '0.192', weight_kg: '25.00', volumetric_weight_kg: '192.00', chargeable_weight_kg: '192.00' },
};

const SCANS = [
  { current: true, weight_kg: '21.00', length_cm: '50.0', width_cm: '40.0', height_cm: '30.0', volume_m3: '0.0600', dimensional_weight_kg: '10.00', measured_at: '2026-10-13T11:00:00Z', measured_by: 'Wim Magazijn' },
  { current: false, weight_kg: '20.00', length_cm: '50.0', width_cm: '40.0', height_cm: '30.0', volume_m3: '0.0600', dimensional_weight_kg: '10.00', measured_at: '2026-10-12T11:00:00Z', measured_by: 'Wim Magazijn' },
];

describe('BookingWarehouseMeasurements', () => {
  it('says so when the warehouse has not measured anything', () => {
    renderWithProviders(<BookingWarehouseMeasurements warehouse={{ intake_sheets: [], package: [] }} />);

    expect(screen.getByText('Not measured by the warehouse yet')).toBeInTheDocument();
  });

  it('copes with a booking from before this existed (no warehouse block)', () => {
    renderWithProviders(<BookingWarehouseMeasurements warehouse={undefined} />);

    expect(screen.getByText('Not measured by the warehouse yet')).toBeInTheDocument();
  });

  it('shows an intake sheet line by line, with its totals and a link to it', () => {
    renderWithProviders(<BookingWarehouseMeasurements warehouse={{ intake_sheets: [SHEET], package: [] }} />);

    expect(screen.getByText(/Intake sheet IN-7/)).toBeInTheDocument();
    expect(screen.getByText('Released')).toBeInTheDocument();
    expect(screen.getByText('60 × 40 × 40 cm')).toBeInTheDocument();
    expect(screen.getByText('12,5 kg')).toBeInTheDocument();
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    expect(screen.getByText(/Total: 3 colli · 0,192 m³ · 25 kg · chargeable 192 kg/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open sheet' })).toHaveAttribute('href', '/warehouse/intake?sheet=41');
  });

  it('shows the newest scanner measurement, with the older ones folded away', () => {
    renderWithProviders(<BookingWarehouseMeasurements warehouse={{ intake_sheets: [], package: SCANS }} />);

    expect(screen.getByText('21 kg')).toBeInTheDocument();
    expect(screen.getByText('Earlier measurements (1)')).toBeInTheDocument();
  });
});

describe('BookingWarehouseMeasurements - stage and photos', () => {
  it('asks the office to confirm a booking the warehouse has not been told about', () => {
    renderWithProviders(<BookingWarehouseMeasurements warehouse={{ intake_sheets: [], package: [], stage: null, photos: [] }} />);

    expect(screen.getByText(/Not sent to the warehouse yet/)).toBeInTheDocument();
    expect(screen.getByText('No photos yet')).toBeInTheDocument();
  });

  it('shows the warehouse stage and the photos the workers took', () => {
    renderWithProviders(
      <BookingWarehouseMeasurements
        warehouse={{
          intake_sheets: [],
          package: SCANS,
          stage: { value: 'measured', label: 'Measured' },
          photos: [{ id: 9, url: '/staff/warehouse/shipments/5/photos/9/', uploaded_at: '2026-10-13T11:00:00Z' }],
        }}
      />,
    );

    expect(screen.getByText('Measured')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Warehouse photo 1' })).toHaveAttribute(
      'src',
      '/api/staff/warehouse/shipments/5/photos/9/',
    );
  });
});

describe('warehouseSummary', () => {
  it('prefers the scanner measurement', () => {
    expect(warehouseSummary({ intake_sheets: [SHEET], package: SCANS })).toBe('0,06 m³ · 21 kg');
  });

  it('falls back to the intake sheet totals', () => {
    expect(warehouseSummary({ intake_sheets: [SHEET], package: [] })).toBe('0,192 m³ · 25 kg');
  });

  it('is null when nothing is measured', () => {
    expect(warehouseSummary({ intake_sheets: [], package: [] })).toBeNull();
    expect(warehouseSummary(undefined)).toBeNull();
  });
});
