// src/pages/Faq/faqContent.js
//
// Which topics and questions the FAQ page shows, in which order, and which
// page of the site a question links to. The words are in translations.js:
//   faq.categories.<topic>.title
//   faq.categories.<topic>.questions.<question>.q     the question
//   faq.categories.<topic>.questions.<question>.a     the answer
//   faq.categories.<topic>.questions.<question>.link  the link text (only
//                                                     when `link` is set here)
//
// TO ADD A QUESTION: add { id } (and `link` if it should point somewhere) to
// the right topic below, then add the same id with q and a to the nl, en and
// pap blocks in translations.js. A test fails if a language is missing it.
//
// Kept apart from Faq.jsx because a file exporting a component may only
// export components (React Fast Refresh).

export const FAQ_CATEGORIES = [
  {
    id: 'goods',
    questions: [
      { id: 'appointment' },
      { id: 'arrival' },
      { id: 'container', link: '/services' },
      { id: 'volume', link: '/contact' },
    ],
  },
  {
    id: 'car',
    questions: [{ id: 'pickup' }, { id: 'cargo' }, { id: 'deregister' }],
  },
  {
    id: 'pickupDelivery',
    questions: [
      { id: 'home' },
      { id: 'webshop', link: '/contact' },
      { id: 'weekend' },
      { id: 'delivery' },
    ],
  },
  {
    id: 'packing',
    questions: [{ id: 'seaworthy', link: '/booking' }],
  },
  {
    id: 'localCosts',
    questions: [{ id: 'what' }, { id: 'emigrate', link: '/destinations' }, { id: 'prepay' }],
  },
  {
    id: 'insurance',
    questions: [
      { id: 'insured', link: '/contact' },
      { id: 'damage', link: '/contact' },
    ],
  },
  {
    id: 'payment',
    questions: [{ id: 'how' }],
  },
];
