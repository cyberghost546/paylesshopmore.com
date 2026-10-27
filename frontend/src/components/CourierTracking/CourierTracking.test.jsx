// The courier view a customer reads under their order: status, warning,
// facts, and every line marked as the courier's or ours.

import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import CourierTracking from './CourierTracking';

const TRACKING = {
  id: 1,
  tracking_number: '3SABC1234567',
  tracking_url: 'https://t.17track.net/en#nums=3SABC1234567',
  carrier: { code: 'postnl', name: 'PostNL', trackable: true },
  shop_name: 'bol.com',
  status: 'in_transit',
  status_display: 'In transit',
  last_location: 'Nieuwegein',
  estimated_delivery: '2026-10-22',
  delivered_at: null,
  last_synced_at: '2026-10-19T12:05:00Z',
  automatic: true,
  timeline: [
    { value: 'order_registered', label: 'Order registered' },
    { value: 'in_transit', label: 'In transit' },
    { value: 'out_for_delivery', label: 'Out for delivery' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'received_at_warehouse', label: 'Received at warehouse' },
  ],
  timeline_index: 1,
  problem: null,
  events: [
    {
      id: 2,
      status: 'in_transit',
      status_display: 'In transit',
      description: 'Parcel sorted',
      location: 'Nieuwegein',
      occurred_at: '2026-10-19T12:02:00Z',
      verified: true,
    },
    {
      id: 1,
      status: 'order_registered',
      status_display: 'Order registered',
      description: 'Checked by our team',
      location: '',
      occurred_at: '2026-10-18T07:00:00Z',
      verified: false,
    },
  ],
};

beforeEach(() => {
  window.localStorage.setItem('plsm.language', 'en');
});

describe('CourierTracking', () => {
  it('shows the courier, number, status and where it is', () => {
    renderWithProviders(<CourierTracking tracking={TRACKING} />);

    expect(screen.getByText('PostNL')).toBeInTheDocument();
    expect(screen.getByText('3SABC1234567')).toBeInTheDocument();
    expect(screen.getAllByText('In transit').length).toBeGreaterThan(0);
    // "Nieuwegein" is both the last location and a line's place.
    expect(screen.getAllByText('Nieuwegein').length).toBeGreaterThan(0);
  });

  it("links to the courier's own tracking page, in a new tab", () => {
    renderWithProviders(<CourierTracking tracking={TRACKING} />);
    const link = screen.getByRole('link', { name: /Follow at the courier/ });
    expect(link).toHaveAttribute('href', 'https://t.17track.net/en#nums=3SABC1234567');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it("tells courier data and our team's lines apart", () => {
    renderWithProviders(<CourierTracking tracking={TRACKING} />);
    const lines = screen.getAllByRole('listitem').filter((item) => item.textContent.includes('Parcel sorted')
      || item.textContent.includes('Checked by our team'));

    expect(within(lines[0]).getByText('Courier')).toBeInTheDocument();
    expect(within(lines[1]).getByText('Our team')).toBeInTheDocument();
  });

  it('warns about a problem in plain words', () => {
    renderWithProviders(
      <CourierTracking
        tracking={{ ...TRACKING, status: 'delivery_failed', problem: { status: 'delivery_failed', label: 'x' } }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('could not deliver this parcel');
  });

  it('says when nothing has come in yet', () => {
    renderWithProviders(<CourierTracking tracking={{ ...TRACKING, events: [], last_synced_at: null }} />);
    expect(screen.getByText(/No updates from the courier yet/)).toBeInTheDocument();
    expect(screen.getByText('Not yet')).toBeInTheDocument();
  });

  it('says so when only our team updates it', () => {
    renderWithProviders(<CourierTracking tracking={{ ...TRACKING, automatic: false, events: [] }} />);
    expect(screen.getByText(/not followed automatically/)).toBeInTheDocument();
  });

  it('says which leg it is and copies the number', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(<CourierTracking tracking={{ ...TRACKING, stage: 'outgoing' }} />);

    expect(screen.getByText('On its way to you')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy tracking number' }));
    expect(writeText).toHaveBeenCalledWith('3SABC1234567');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('labels made-up test data so it never passes for the courier', () => {
    const events = TRACKING.events.map((event) => ({ ...event, verified: false, test_data: true }));
    renderWithProviders(<CourierTracking tracking={{ ...TRACKING, test_data: true, events }} />);

    expect(screen.getByRole('note')).toHaveTextContent('not real information from the courier');
    expect(screen.queryByText('Courier')).toBeNull();
    // The card's note, plus one label per line.
    expect(screen.getAllByText('Test data')).toHaveLength(3);
  });
});
