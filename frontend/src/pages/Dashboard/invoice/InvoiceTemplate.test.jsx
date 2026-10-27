// The printable invoice template.
//
// The promise tested here: the totals PRINTED on the sheet are exactly the
// totals CALCULATED by invoiceMath - for every example the server is tested
// with too (backend/invoicing/fixtures/calculation_cases.json). So the
// on-screen preview, the printout and the server's PDF all agree.

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import cases from '../../../../../backend/invoicing/fixtures/calculation_cases.json';
import InvoiceTemplate from './InvoiceTemplate';
import { buildDocument, computeInvoice, emptyForm, newLine } from './invoiceForm';
import { calculateTotals, formatEuro, parseCents } from './invoiceMath';

const SETTINGS = {
  standard_vat_rate: '21.00',
  export_vat_rate: '0.00',
  insurance_rate_percent: null,
  insurance_minimum: null,
  payment_instructions: 'Gelieve bij betaling het zendingsnummer ({zendingsnummer}) te vermelden als omschrijving.',
  terms_intro: 'Wanneer u een zending doet met {bedrijf}, gaat u akkoord met:',
  terms_items: 'De Algemene voorwaarden van {bedrijf}\nDe Fenex-condities',
  exclusions_title: '{bedrijf} is niet verantwoordelijk voor:',
  exclusions_items: 'Opslag en/of havenkosten\nInvoerrechten',
  export_vat_note: '0% Nederlandse omzetbelasting wegens export.',
  footer_text: 'On all our warehousing services the Warehousing Conditions apply.',
};
const CONFIG = {
  settings: SETTINGS,
  company: {
    name: 'Pay Less Shop More', street: 'Hertzstraat 10', postcode_city: '2652 XX Berkel en Rodenrijs',
    kvk: '9322289', vat: 'NL866317843B01', iban: 'NL79INGB0115158162',
    email: 'info@paylessshopmore.com', website: 'www.paylessshopmore.com', phone: '010 310 5317',
  },
  permissions: { can_adjust: true },
};

/** A form whose lines are the charges and adjustments of a shared case. */
function formFor(example) {
  return {
    ...emptyForm(),
    number: 'PLSM20260012',
    invoice_date: '2026-10-07',
    shipment_number: 'CIT-SE-006648',
    export_verified: example.vat_rate === '0',
    lines: [
      ...example.charges.map((amount, i) => newLine('charge', `Kosten ${i + 1}`, amount)),
      ...example.adjustments.map((amount) => newLine('adjustment', '', amount)),
    ],
  };
}

function renderFor(form) {
  const doc = buildDocument(form, CONFIG, computeInvoice(form, SETTINGS));
  render(<InvoiceTemplate doc={doc} />);
  return doc;
}

describe('InvoiceTemplate totals match the calculation', () => {
  for (const example of cases.totals) {
    it(example.name, () => {
      renderFor(formFor(example));
      const expected = calculateTotals(
        example.charges.map(parseCents),
        example.adjustments.map(parseCents),
        example.vat_rate === '0' ? '0' : '21',
      );

      // What the sheet shows ...
      expect(screen.getByTestId('sheet-subtotal')).toHaveTextContent(formatEuro(expected.subtotal));
      expect(screen.getByTestId('sheet-vat')).toHaveTextContent(formatEuro(expected.vat));
      expect(screen.getByTestId('sheet-total')).toHaveTextContent(formatEuro(expected.total));
      // ... is what the server must calculate too (the shared expectation).
      expect(formatEuro(expected.total)).toBe(formatEuro(parseCents(example.expected.total)));
    });
  }
});

describe('InvoiceTemplate layout', () => {
  it('shows the PDF reference blocks with Dutch labels', () => {
    renderFor({
      ...formFor(cases.totals[1]),
      bill_to: 'John Smith\nKaya Grandi 1',
      phone: '+599 9 123 4567',
      port_of_loading: 'Rotterdam, NL',
      port_of_discharge: 'Willemstad, CUR',
      goods_description: 'Dry Aging fridge and stove',
      pieces: '2',
      weight_kg: '199',
      volume_m3: '1,55',
      relation_number: 'PLSM0009',
      order_number: 'PLSM0011',
    });

    const sheet = screen.getByRole('article', { name: 'Factuur PLSM20260012' });
    for (const text of [
      'FACTUUR', 'Factuurnummer', 'Factuurdatum', 'Zendingsnummer', 'Relatienummer',
      'Laadhaven', 'Loshaven', 'Goederen omschrijving', 'Stuks', 'Gewicht', 'Volume',
      'Ordernummer', 'Subtotaal dienstverlening', 'Totaal excl. BTW:', 'Totaal BTW (0% Export):',
      'Totaal te betalen:', 'PLSM20260012', '07-10-2026', 'CIT-SE-006648', 'Willemstad, CUR',
      'Dry Aging fridge and stove', '199 kg', '1,55 m³', 'Tel: +599 9 123 4567', 'NL79INGB0115158162',
    ]) {
      expect(within(sheet).getAllByText(text, { exact: true }).length).toBeGreaterThan(0);
    }
  });

  it('fills the shipment number and company name into the configured texts', () => {
    renderFor(formFor(cases.totals[1]));

    expect(
      screen.getByText('Gelieve bij betaling het zendingsnummer (CIT-SE-006648) te vermelden als omschrijving.'),
    ).toBeInTheDocument();
    expect(screen.getByText('De Algemene voorwaarden van Pay Less Shop More')).toBeInTheDocument();
    expect(screen.getByText('De Fenex-condities')).toBeInTheDocument();
    expect(screen.getByText('0% Nederlandse omzetbelasting wegens export.')).toBeInTheDocument();
  });

  it('prints a contractual adjustment under the subtotal', () => {
    renderFor(formFor(cases.totals[2]));

    expect(screen.getByText('Contractuele verrekening conform overeenkomst')).toBeInTheDocument();
    expect(screen.getByText('-€ 100,00')).toBeInTheDocument();
  });

  it('labels a negative total as a credit', () => {
    renderFor(formFor(cases.totals[4]));

    expect(screen.getByText('Creditbedrag (te ontvangen):')).toBeInTheDocument();
    expect(screen.getByTestId('sheet-total')).toHaveTextContent('-€ 1.370,48');
  });

  it('shows the standard VAT rate and no export note when export is not verified', () => {
    renderFor(formFor(cases.totals[0]));

    expect(screen.getByText('Totaal BTW (21%):')).toBeInTheDocument();
    expect(screen.queryByText('0% Nederlandse omzetbelasting wegens export.')).not.toBeInTheDocument();
  });

  it('shows the volume weight apart from the actual weight', () => {
    renderFor({
      ...formFor(cases.totals[1]),
      weight_kg: '199',
      useMeasurements: true,
      measurements: [{ key: 1, length_cm: '120', width_cm: '80', height_cm: '100', count: '1' }],
    });

    expect(screen.getByText('199 kg')).toBeInTheDocument();
    expect(screen.getByText('Volumegewicht: 160 kg')).toBeInTheDocument();
    expect(screen.getByText('0,96 m³')).toBeInTheDocument();
  });
});
