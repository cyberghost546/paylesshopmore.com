// "Photos for the customer" on the warehouse package page: a photo is
// uploaded as soon as it is taken, and a wrong one can be removed.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import {
  deletePackagePhoto,
  listPackagePhotos,
  uploadPackagePhotos,
} from '../../api/warehouse';
import PackagePhotos from './PackagePhotos';

vi.mock('../../api/warehouse', async (importOriginal) => ({
  ...(await importOriginal()),
  listPackagePhotos: vi.fn(),
  uploadPackagePhotos: vi.fn(),
  deletePackagePhoto: vi.fn(),
}));

const photo = (id) => ({ id, url: `/staff/warehouse/shipments/5/photos/${id}/`, uploaded_at: '2026-10-05T10:00:00Z' });
const jpeg = (name) => new File([new Uint8Array(2000)], name, { type: 'image/jpeg' });

beforeEach(() => {
  listPackagePhotos.mockReset().mockResolvedValue([]);
  uploadPackagePhotos.mockReset();
  deletePackagePhoto.mockReset().mockResolvedValue(null);
});

describe('photos for the customer', () => {
  it('uploads a photo as soon as it is taken', async () => {
    const user = userEvent.setup();
    uploadPackagePhotos.mockResolvedValue([photo(1)]);
    const onChanged = vi.fn();
    renderWithProviders(<PackagePhotos shipmentId={5} onChanged={onChanged} />);

    await user.upload(screen.getByLabelText('Take photo'), jpeg('box.jpg'));

    expect(uploadPackagePhotos).toHaveBeenCalledWith(5, [expect.objectContaining({ name: 'box.jpg' })]);
    expect(await screen.findByRole('img', { name: 'Photo 1' })).toHaveAttribute(
      'src',
      '/api/staff/warehouse/shipments/5/photos/1/',
    );
    expect(screen.getByText('Saved. The customer can now see the photo.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('removes a photo of the wrong box', async () => {
    const user = userEvent.setup();
    listPackagePhotos.mockResolvedValue([photo(1), photo(2)]);
    renderWithProviders(<PackagePhotos shipmentId={5} />);

    await user.click(await screen.findByRole('button', { name: 'Remove photo 1' }));

    expect(deletePackagePhoto).toHaveBeenCalledWith(5, 1);
    // The one left is photo 2, now numbered first.
    const images = await screen.findAllByRole('img');
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute('src', '/api/staff/warehouse/shipments/5/photos/2/');
  });

  it('refuses a photo over 10 MB without sending it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PackagePhotos shipmentId={5} />);

    await user.upload(
      screen.getByLabelText('Take photo'),
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.jpg', { type: 'image/jpeg' }),
    );

    expect(uploadPackagePhotos).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('huge.jpg is larger than 10 MB.');
  });
});
