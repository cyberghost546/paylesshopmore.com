// The Package Measurement page, start to finish, with a fake camera and a
// fake measurement: start the camera, scan, confirm, save - and the ways it
// can go wrong.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startCamera, stopCamera, captureFrame } from '../../measurement/cameraService';
import { measurePackage } from '../../measurement/measurementService';
import { renderWithProviders } from '../../test/utils';
import PackageMeasurement from './PackageMeasurement';

vi.mock('../../measurement/cameraService', async (importOriginal) => ({
  ...(await importOriginal()),
  startCamera: vi.fn(),
  stopCamera: vi.fn(),
  captureFrame: vi.fn(),
}));

vi.mock('../../measurement/measurementService', async (importOriginal) => ({
  ...(await importOriginal()),
  measurePackage: vi.fn(),
}));

vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));

const GOOD = {
  markerDetected: true,
  packageDetected: true,
  dimensions: { length: 45.2, width: 31.8, height: 27.9, scale: 20 },
  problems: [],
  demo: true,
};

function renderPage(route = '/warehouse/measurements/camera') {
  return renderWithProviders(<PackageMeasurement />, { route });
}

beforeEach(() => {
  window.localStorage.setItem('plsm.language', 'en');
  startCamera.mockReset().mockResolvedValue({ getTracks: () => [] });
  stopCamera.mockReset();
  captureFrame.mockReset().mockReturnValue({ width: 1, height: 1, imageData: { data: [] } });
  measurePackage.mockReset().mockResolvedValue(GOOD);
});

describe('Package Measurement', () => {
  it('says plainly that the numbers are a demo', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Package measurement' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Prototype');
    // Empty state before anything is scanned.
    expect(screen.getByText(/No measurement yet/)).toBeInTheDocument();
    expect(screen.getByText('The camera is off. Press Start camera.')).toBeInTheDocument();
  });

  it('starts the camera, scans, confirms and saves', async () => {
    const user = userEvent.setup();
    renderPage('/warehouse/measurements/camera?package=PLSM-1001');

    await user.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(startCamera).toHaveBeenCalledTimes(1);
    // The placement instructions are always there.
    expect(screen.getByText('Place the entire package inside the frame.')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Scan package' }));
    expect(captureFrame).toHaveBeenCalled();
    expect(await screen.findByText('45.2')).toBeInTheDocument();
    expect(screen.getByText('31.8')).toBeInTheDocument();
    expect(screen.getByText('27.9')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm measurement' }));
    expect(screen.getByRole('heading', { name: 'Measurement confirmed.' })).toBeInTheDocument();
    // The package from the address is filled in.
    expect(screen.getByLabelText('Package ID or tracking number')).toHaveValue('PLSM-1001');

    await user.click(screen.getByRole('button', { name: 'Save measurement' }));
    expect(await screen.findByText(/Saved for this session/)).toBeInTheDocument();
    // And listed with what else was saved while the page was open.
    expect(screen.getByRole('heading', { name: 'Saved this session' })).toBeInTheDocument();
    expect(screen.getByText('PLSM-1001')).toBeInTheDocument();
    expect(screen.getByText('45.2 × 31.8 × 27.9 cm')).toBeInTheDocument();
  });

  it('will not confirm without a marker, and says what to do', async () => {
    const user = userEvent.setup();
    measurePackage.mockResolvedValue({
      markerDetected: false,
      packageDetected: true,
      dimensions: null,
      problems: ['noMarker'],
      demo: true,
    });
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));
    await user.click(await screen.findByRole('button', { name: 'Scan package' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Reference marker not detected. Make sure it is visible in the camera.',
    );
    expect(screen.queryByRole('button', { name: 'Confirm measurement' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Scan again' })).toBeInTheDocument();
  });

  it('explains a refused camera instead of failing silently', async () => {
    const user = userEvent.setup();
    startCamera.mockRejectedValue(Object.assign(new Error('no'), { code: 'blocked' }));
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Camera access was not allowed.');
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeEnabled();
  });

  it('turns the camera off when the page is left', async () => {
    const user = userEvent.setup();
    const stream = { getTracks: () => [] };
    startCamera.mockResolvedValue(stream);
    const { unmount } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));
    await screen.findByRole('button', { name: 'Scan package' });
    unmount();

    expect(stopCamera).toHaveBeenCalledWith(stream);
  });

  it('can be stopped and started again', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Start camera' }));
    await user.click(await screen.findByRole('button', { name: 'Stop camera' }));

    expect(stopCamera).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeInTheDocument();
  });
});
