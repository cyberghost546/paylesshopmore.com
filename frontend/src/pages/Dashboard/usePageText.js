// src/pages/Dashboard/usePageText.js
//
// The words of one office page, in the language the dashboard is set to.
//
//   const d = usePageText('workers');
//   d('title')                              -> "Workers" / "Medewerkers" / ...
//   d('sent', { email: 'a@b.nl' })          -> fills {email}
//
// The sentences live in i18n/dashboardPageTranslations.js, one block per
// language and one section per page. A missing key falls back to Dutch, then to
// the key itself, so a gap is visible rather than blank.

import { useCallback } from 'react';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';

export function usePageText(page) {
  const { t } = useLanguage();
  return useCallback((key, values) => fill(t(`dashboard.pages.${page}.${key}`), values), [t, page]);
}

/**
 * An options list (value + English label, from api/staff.js) with its labels
 * in the dashboard language: translatedOptions(PACKAGE_STATUSES, c, 'packageStatus')
 * where c = usePageText('common'). A value with no translation keeps its label.
 */
export function translatedOptions(options, c, group) {
  return options.map((option) => {
    const key = `${group}.${option.value}`;
    const label = c(key);
    return { ...option, label: label.endsWith(key) ? option.label : label };
  });
}

/**
 * One value's label in the dashboard language, or `fallback` (usually the
 * server's own English `*_display`) when there is no translation for it:
 * labelFor(c, 'packageStatus', pkg.status, pkg.status_display).
 */
export function labelFor(c, group, value, fallback = value) {
  const key = `${group}.${value}`;
  const label = c(key);
  return label.endsWith(key) ? fallback : label;
}
