// The customer's package photos: grid, big viewer, previous/next, close.

import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import PhotoGallery from './PhotoGallery';

const PHOTOS = [
  { id: 1, url: '/packages/9/photos/1/', uploaded_at: '2026-10-12T09:55:00Z' },
  { id: 2, url: '/packages/9/photos/2/', uploaded_at: '2026-10-12T09:56:00Z' },
  { id: 3, url: '/packages/9/photos/3/', uploaded_at: '2026-10-12T09:57:00Z' },
];

describe('PhotoGallery', () => {
  it('shows nothing without photos', () => {
    renderWithProviders(<PhotoGallery photos={[]} title="Photos of your package" />);
    expect(screen.queryByText('Photos of your package')).not.toBeInTheDocument();
  });

  it('opens a photo big, steps through them and closes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PhotoGallery photos={PHOTOS} title="Photos of your package" />);

    expect(screen.getByText('(3)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open: Photo 2' }));

    const viewer = screen.getByRole('dialog', { name: 'Viewing Photo 2' });
    expect(viewer).toHaveTextContent('2 / 3');
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/packages/9/photos/2/');

    await user.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('3 / 3');
    await user.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('1 / 3'); // wraps around

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a clear tile when a photo file is gone', () => {
    renderWithProviders(<PhotoGallery photos={PHOTOS.slice(0, 1)} title="Photos" />);
    fireEvent.error(screen.getByAltText('Photo 1'));
    expect(screen.getByText('Photo no longer available')).toBeInTheDocument();
  });
});
