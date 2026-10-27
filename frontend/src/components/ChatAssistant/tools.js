// src/components/ChatAssistant/tools.js
//
// What the assistant's tools do. The model (on the server) only decides to
// call one; it runs here, in the visitor's browser, and its result is sent
// back so the model can answer. See backend/assistant/ai.py for the other
// half, including the descriptions the model reads.
//
//   calculate_shipping  the Calculator page's own sums (src/calculator), so
//                       the chat can only quote prices that page would show.
//   fill_booking_form   types answers into the booking form (bookingBridge.js).
//   open_page           goes to a page of the site.
//
// Every argument is checked here again: the model's output is not trusted to
// have the right shape.

import { calculate, validateInput } from '../../calculator/calculate';
import { DESTINATIONS as PRICED_ISLANDS, IMPORT_CATEGORIES } from '../../calculator/rates';
import { DESTINATIONS as BOOKING_DESTINATIONS, FREIGHT } from '../../api/booking';
import { fillBookingForm } from './bookingBridge';

export const PAGES = {
  home: '/',
  calculator: '/calculator',
  booking: '/booking',
  contact: '/contact',
  faq: '/faq',
  services: '/services',
  tutorial: '/tutorial',
  profile: '/profile',
  destinations: '/destinations',
};

// The booking form's text fields the chat may fill. Not the terms tick box,
// the signature or the emigration statements: the visitor does those.
const TEXT_FIELDS = [
  'destination_other',
  'sender_first_name',
  'sender_last_name',
  'sender_address',
  'sender_postal_code',
  'sender_city',
  'sender_phone',
  'sender_email',
  'recipient_first_name',
  'recipient_last_name',
  'recipient_address',
  'recipient_city',
  'recipient_phone',
  'recipient_email',
  'recipient_crib_number',
  'notes',
];
const MAX_FIELD_LENGTH = 200;

function parse(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** The calculator, with the model's arguments. */
function calculateShipping(args) {
  if (!PRICED_ISLANDS.includes(args.destination)) {
    return {
      priced: false,
      note: 'There are no online prices for this island yet. Suggest a quote via the Contact page.',
    };
  }
  if (!IMPORT_CATEGORIES.includes(args.category)) {
    return { error: 'Unknown category.', valid_categories: IMPORT_CATEGORIES };
  }

  const input = {
    destination: args.destination,
    priceInclVat: Number(args.price_incl_vat),
    vatPercent: [0, 9, 21].includes(Number(args.vat_percent)) ? Number(args.vat_percent) : 21,
    lengthCm: Number(args.length_cm),
    widthCm: Number(args.width_cm),
    heightCm: Number(args.height_cm),
    weightGrams: Number(args.weight_grams),
    category: args.category,
    transport: args.transport === 'air' ? 'air' : 'sea',
  };
  const problems = Object.keys(validateInput(input));
  if (problems.length) {
    return { error: 'These values must be numbers above 0.', fields: problems };
  }

  const result = calculate(input);
  // Everything known so far added up. The page shows a total only when the
  // island's tax is known too; this tells the model what is and is not in it.
  const known = [result.freight, result.feesTotal, result.duty].filter((value) => value !== null);
  return {
    ...result,
    currency: 'EUR',
    sum_of_known_costs: result.priced
      ? Math.round(known.reduce((sum, value) => sum + value, 0) * 100) / 100
      : null,
    not_included:
      result.localTax === null
        ? 'The island\'s import tax (OB) is not in this price yet, nor local costs at the destination.'
        : 'Local costs at the destination.',
    note: 'An indication, not a quote.',
  };
}

/** Only fields the form has, with values of the right kind. */
export function cleanBookingFields(args) {
  const fields = {};
  for (const name of TEXT_FIELDS) {
    if (typeof args[name] === 'string' && args[name].trim()) {
      fields[name] = args[name].trim().slice(0, MAX_FIELD_LENGTH);
    }
  }
  if (FREIGHT.some((option) => option.value === args.freight)) fields.freight = args.freight;
  if (BOOKING_DESTINATIONS.some((option) => option.value === args.destination)) {
    fields.destination = args.destination;
  }
  if (typeof args.insured === 'boolean') fields.insured = args.insured;
  if (Number(args.insured_value_eur) > 0) fields.insured_value_eur = String(Number(args.insured_value_eur));
  return fields;
}

/**
 * Run one tool call. Returns its result as JSON text, for the model.
 *
 * @param {string} name
 * @param {string} rawArguments  JSON text, as the model wrote it
 * @param {{ navigate: (path: string) => void, pathname: string }} page
 */
export function runTool(name, rawArguments, { navigate, pathname }) {
  const args = parse(rawArguments);
  let result;

  if (name === 'calculate_shipping') {
    result = calculateShipping(args);
  } else if (name === 'fill_booking_form') {
    const fields = cleanBookingFields(args);
    if (pathname !== PAGES.booking) navigate(PAGES.booking);
    fillBookingForm(fields);
    result = {
      filled: Object.keys(fields),
      reminder: 'The visitor must still check the form, add their orders, tick the terms and sign.',
    };
  } else if (name === 'open_page' && PAGES[args.page]) {
    navigate(PAGES[args.page]);
    result = { opened: PAGES[args.page] };
  } else {
    result = { error: 'Unknown tool or page.' };
  }
  return JSON.stringify(result);
}
