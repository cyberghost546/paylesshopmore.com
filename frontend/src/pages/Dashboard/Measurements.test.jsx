// The measured lines on an intake sheet: the weights shown under each line,
// and how they follow the Transportwijze (zeevracht or luchtvracht).

import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Measurements from './Measurements';
import { renderWithProviders } from '../../test/utils';
import { EMPTY_LINE } from './measure';

function renderLine(line, freight = 'sea') {
  return renderWithProviders(
    <Measurements
      lines={[{ ...EMPTY_LINE, ...line }]}
      onChange={vi.fn()}
      freight={freight}
      declaredWeight={null}
      disabled={false}
    />,
  );
}

const PALLET = { length_cm: '120', width_cm: '80', height_cm: '50', weight_kg: '250' };

describe('weights under a measured line', () => {
  it('zeevracht: 120 x 80 x 50 cm, 250 kg -> 0,480 m³, 480 kg volume, 480 kg charged', () => {
    renderLine(PALLET, 'sea');

    const weights = screen.getByLabelText('Weights per item');
    expect(weights).toHaveTextContent('120 × 80 × 50 cm');
    expect(weights).toHaveTextContent('Actual weight250,00 kg');
    expect(weights).toHaveTextContent('Volume0,480 m³480.000 cm³');
    expect(weights).toHaveTextContent('Volume weight480,00 kgSea freight (LCL): 1 m³ = 1000 kg');
    expect(weights).toHaveTextContent('Chargeable weight480,00 kg (volume)');
  });

  it('luchtvracht: the same pallet -> 80 kg volume, so the 250 kg actual weight is charged', () => {
    renderLine(PALLET, 'air');

    const weights = screen.getByLabelText('Weights per item');
    expect(weights).toHaveTextContent('Volume weight80,00 kgAir freight: 1 m³ = 167 kg');
    expect(weights).toHaveTextContent('Chargeable weight250,00 kg (actual)');
  });

  it('switches the moment the Transportwijze changes', () => {
    const { rerender } = renderLine(PALLET, 'sea');
    expect(screen.getByLabelText('Weights per item')).toHaveTextContent('Chargeable weight480,00 kg');

    rerender(
      <Measurements
        lines={[{ ...EMPTY_LINE, ...PALLET }]}
        onChange={vi.fn()}
        freight="air"
        declaredWeight={null}
        disabled={false}
      />,
    );
    expect(screen.getByLabelText('Weights per item')).toHaveTextContent('Chargeable weight250,00 kg');
  });

  it('without a Transportwijze: shows the volume, and asks for the transport', () => {
    renderLine(PALLET, '');

    const weights = screen.getByLabelText('Weights per item');
    expect(weights).toHaveTextContent('Volume0,480 m³');
    expect(weights).toHaveTextContent('Volume weight—');
    expect(weights).toHaveTextContent('Chargeable weight—');
    expect(screen.getByText(/Choose a freight \(sea or air\)/)).toBeInTheDocument();
  });

  it('says which box is still missing instead of calculating', () => {
    renderLine({ length_cm: '50', width_cm: '40', weight_kg: '6' });

    expect(screen.getByText('Fill in H to see the volume.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Weights per item')).not.toBeInTheDocument();
  });

  it('shows the volume and volume weight from L, B and H alone, before the weight is in', () => {
    renderLine({ length_cm: '50', width_cm: '40', height_cm: '76' }, 'air');

    const weights = screen.getByLabelText('Weights per item');
    // 50 x 40 x 76 = 152,000 cm³ = 0.152 m³, and by air 152,000 / 6000 = 25.33 kg
    expect(weights).toHaveTextContent('Volume0,152 m³152.000 cm³');
    expect(weights).toHaveTextContent('Volume weight25,33 kg');
    expect(weights).toHaveTextContent('Actual weight—');
    expect(weights).toHaveTextContent('Chargeable weight—');
    expect(screen.getByText('Fill in Kg to see the chargeable weight.')).toBeInTheDocument();
  });

  it('refuses a size of 0', () => {
    renderLine({ length_cm: '50', width_cm: '0', height_cm: '30', weight_kg: '6' });

    expect(screen.getByText(/W: must be a number above 0/)).toBeInTheDocument();
  });

  it('accepts a weight of 0, but not a negative one', () => {
    renderLine({ ...PALLET, weight_kg: '-5' });
    expect(screen.getByText(/Kg: must be a number, 0 or more/)).toBeInTheDocument();
  });

  it('shows nothing on a line nobody has started', () => {
    renderLine({});

    expect(screen.queryByLabelText('Weights per item')).not.toBeInTheDocument();
    expect(screen.queryByText(/Fill in/)).not.toBeInTheDocument();
  });
});

describe('the totals bar', () => {
  it('shows the chargeable weight by the zeevracht rule', () => {
    renderLine({ ...PALLET, quantity: '2' }, 'sea');

    // 2 x 480 kg volume weight beats 2 x 250 kg
    expect(screen.getByText(/chargeable · Sea freight \(LCL\), volume weight 960,0 kg/)).toBeInTheDocument();
  });

  it('shows the chargeable weight by the luchtvracht rule', () => {
    renderLine({ ...PALLET, quantity: '2' }, 'air');

    expect(screen.getByText(/chargeable · Air freight, volume weight 160,0 kg/)).toBeInTheDocument();
  });
});
