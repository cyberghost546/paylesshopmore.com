// src/pages/Dashboard/invoice/useInvoiceText.js
//
// The invoice pages' words, in the language picked in the dashboard's
// language menu (Nederlands, English or Papiamentu).
//
//   const tr = useInvoiceText();
//   tr('editor.save')                          -> "Save invoice"
//   tr('editor.titleSaved', { number: 'X1' })  -> "Invoice X1"
//
// The sentences themselves are in src/i18n/invoiceTranslations.js.

import { useCallback } from 'react';
import { fill } from '../../../i18n/fill';
import { useLanguage } from '../../../i18n/useLanguage';

export function useInvoiceText() {
  const { t } = useLanguage();
  return useCallback((key, values) => fill(t(`dashboard.invoice.${key}`), values), [t]);
}
