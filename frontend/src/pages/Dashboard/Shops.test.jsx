// "Sort A–Z" on the Shops page: every shop goes into name order in one
// request, ignoring capitals, and the button waits while a search is active.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAllShops, reorderShops } from '../../api/shops';
import { renderWithProviders } from '../../test/utils';
import Shops from './Shops';

vi.mock('../../api/shops', () => ({
  listAllShops: vi.fn(),
  reorderShops: vi.fn(),
  createShop: vi.fn(),
  deleteShop: vi.fn(),
  updateShop: vi.fn(),
}));

const shop = (id, name) => ({ id, name, url: `https://${id}.nl/`, description: '', is_active: true, logo_url: null });

beforeEach(() => {
  vi.clearAllMocks();
  listAllShops.mockResolvedValue([shop(1, 'Zalando'), shop(2, 'bol.com'), shop(3, 'IKEA'), shop(4, 'Action')]);
  reorderShops.mockResolvedValue([]);
});

describe('Sort A–Z', () => {
  it('sends every shop in name order, lower case sorted with the capitals', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Shops />);

    await user.click(await screen.findByRole('button', { name: 'Sort A–Z' }));

    expect(reorderShops).toHaveBeenCalledWith([4, 2, 3, 1]);
    const names = screen.getAllByRole('textbox', { name: /^Name of / }).map((input) => input.value);
    expect(names).toEqual(['Action', 'bol.com', 'IKEA', 'Zalando']);
  });

  it('is not offered while a search narrows the list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Shops />);

    await user.type(await screen.findByRole('searchbox'), 'ik');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sort A–Z' })).toBeDisabled());
  });
});
