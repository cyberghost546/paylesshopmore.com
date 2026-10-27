// "Foto's van de schade" on the intake sheet: there once damage is reported,
// uploads straight away, and locked with a released sheet.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listIntakePhotos, uploadIntakePhotos } from '../../api/staff';
import { captureJpeg } from '../../measurement/cameraService';
import IntakePhotos from './IntakePhotos';
import { renderWithProviders } from '../../test/utils';

vi.mock('../../api/staff', () => ({
  listIntakePhotos: vi.fn(),
  uploadIntakePhotos: vi.fn(),
  deleteIntakePhoto: vi.fn(),
}));

// jsdom has no camera: a camera that is simply "live", and a picture from it.
vi.mock('../Warehouse/camera/useCamera', () => ({
  useCamera: () => ({
    videoRef: { current: null },
    status: 'live',
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));
vi.mock('../../measurement/cameraService', () => ({ captureJpeg: vi.fn() }));

const PHOTO = { id: 7, url: '/staff/intake/3/photos/7/', uploaded_at: '2026-10-12T10:00:00Z' };

beforeEach(() => {
  // The intake sheet is written in Dutch; these tests read it that way.
  window.localStorage.setItem('plsm.language', 'nl');
  vi.clearAllMocks();
  listIntakePhotos.mockResolvedValue([]);
});

describe('intake sheet photos', () => {
  it('stays out of the way while there is no damage', async () => {
    const { container } = renderWithProviders(<IntakePhotos sheetId={3} show={false} locked={false} />);

    await vi.waitFor(() => expect(listIntakePhotos).toHaveBeenCalledWith(3));
    expect(container).toBeEmptyDOMElement();
  });

  it('takes a photo with the camera on the page, and uploads it', async () => {
    const user = userEvent.setup();
    const picture = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    captureJpeg.mockResolvedValue(picture);
    uploadIntakePhotos.mockResolvedValue([PHOTO]);
    renderWithProviders(<IntakePhotos sheetId={3} show locked={false} />);

    await user.click(screen.getByRole('button', { name: 'Foto maken' }));
    await user.click(screen.getByRole('button', { name: 'Maak foto' }));

    expect(uploadIntakePhotos).toHaveBeenCalledWith(3, [picture]);
    expect(await screen.findByAltText('Foto 1 van de schade')).toBeInTheDocument();

    // Closed again with Sluiten.
    await user.click(screen.getByRole('button', { name: 'Sluiten' }));
    expect(screen.queryByRole('button', { name: 'Maak foto' })).toBeNull();
  });

  it('also takes a photo that is already on the device', async () => {
    const user = userEvent.setup();
    uploadIntakePhotos.mockResolvedValue([PHOTO]);
    const { container } = renderWithProviders(<IntakePhotos sheetId={3} show locked={false} />);

    expect(screen.getByRole('button', { name: 'Bestand kiezen' })).toBeInTheDocument();

    const file = new File(['x'], 'schade.jpg', { type: 'image/jpeg' });
    await user.upload(container.querySelector('input[type="file"]'), file);

    expect(uploadIntakePhotos).toHaveBeenCalledWith(3, [file]);
    expect(await screen.findByAltText('Foto 1 van de schade')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nog een foto maken (1/10)' })).toBeInTheDocument();
  });

  it('shows the photos of a released sheet, but cannot change them', async () => {
    listIntakePhotos.mockResolvedValue([PHOTO]);
    renderWithProviders(<IntakePhotos sheetId={3} show locked />);

    expect(await screen.findByAltText('Foto 1 van de schade')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
