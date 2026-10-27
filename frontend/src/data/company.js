// src/data/company.js
//
// The company's address and contact details, written down once. Used by the
// contact page, the tutorial page and the onboarding tour
// (src/components/Tutorial): if any of this changes, change it here.

// How to reach the office. The phone number is shown as written; phoneHref is
// the same number in the form a phone's dialler needs.
export const CONTACT = {
  phone: '+31 10 310 5317',
  phoneHref: 'tel:+31103105317',
  email: 'info@paylesshopmore.com',
};

// The warehouse address customers type into a webshop's checkout.
//
// Not translated: an address is typed into a form exactly as it stands. The
// customer's own first name goes in the first-name field, and the company
// name in the last-name field - that is how the warehouse knows whose parcel
// it is.

export const WAREHOUSE_ADDRESS = {
  lastName: 'Pay less Shop More',
  street: 'Hertzstraat 10',
  postcode: '2652 XX',
  town: 'Berkel en Rodenrijs',
};

// The company as a legal entity, for the privacy statement's "Responsible
// entity" section (src/pages/Privacy).
//
//   chamberOfCommerce  the KvK (Chamber of Commerce) registration number.
//                      LEFT EMPTY ON PURPOSE: fill in Pay Less Shop More's
//                      own number here, as a string, e.g. '12345678'. While
//                      it is null the privacy page simply leaves the sentence
//                      about it out. Never copy another company's number.
export const COMPANY = {
  name: 'Pay Less Shop More',
  chamberOfCommerce: null,
};
